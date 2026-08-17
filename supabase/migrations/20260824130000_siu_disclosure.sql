-- ============================================================================
-- §15 — Releasing SIU material back to CID.
--
-- SIU needs to hand CID a single piece of intelligence — a name, a link, an
-- exhibit, a warning — WITHOUT surrendering the investigation it came from.
-- Four release routes, all auditable, all revocable:
--
--   'cid'           the whole Division. A general officer-safety or
--                   intelligence bulletin.
--   'case_members'  everyone who can open one named CID case. The normal
--                   route: "this belongs in your case file".
--   'investigator'  exactly one named officer. For material that should not
--                   circulate even within a case team.
--   (item_type      'intelligence' + audience 'cid' is the "Release
--                   Intelligence" action; the same table serves all four.)
--
-- ── The snapshot is the mechanism ──────────────────────────────────────────
-- A disclosure carries a COPY of the released content (title + body), taken
-- at release time. It is not a pointer into an SIU row and it grants no
-- access to anything. That single choice is what makes the requirement
-- achievable:
--
--   * releasing one item cannot widen into the investigation, because there
--     is no edge from the disclosure back to any SIU record a CID user may
--     traverse;
--   * the released text is immutable — what CID acted on is exactly what was
--     released, which is what makes it usable in a prosecution;
--   * revocation is real. Revoking removes the row from every CID surface;
--     it does not have to claw back a permission that was never granted.
--
-- ── The origin is never disclosed ──────────────────────────────────────────
-- siu_case_id and source_item_id exist for SIU's own trail. A CID user never
-- reads this table at all: siu_disclosures_sel is SIU-side only
-- (private.siu_case_read). CID reads through public.siu_released_intelligence(),
-- a definer RPC that projects ONLY the non-identifying columns. There is no
-- column-level leak to get wrong, no view to forget to lock down, and no
-- query shape that returns the source investigation's id or case number.
-- CID sees "Special Investigation Unit" as the origin and nothing more.
--
-- ── Who may release ────────────────────────────────────────────────────────
-- A field agent with access to that investigation (siu_case_access +
-- siu_is_agent). Oversight standing cannot release: the Director of CID
-- deciding what SIU tells CID about CID would invert the point of the unit.
-- On a compartmented investigation, access means being on the allow-list, so
-- release authority is confined to the compartment automatically.
--
-- Revocation: the releasing agent, or SIU command over that investigation.
-- Acknowledgement: the CID recipient, recorded so the trail shows receipt.
--
-- ADDITIVE ONLY: one table, four RPCs. Invisible to CID until an agent
-- deliberately releases something, and a no-op while the release gate is
-- closed.
--
-- APPLICATION NOTE: applied live as siu_disclosure.
-- ============================================================================

create table if not exists public.siu_disclosures (
  id uuid primary key default gen_random_uuid(),
  -- The SOURCE investigation. Never projected to CID.
  siu_case_id uuid not null references public.cases(id) on delete cascade,
  -- The SIU row this was drawn from, when there is one. SIU-side trail only.
  source_item_id uuid,
  item_type text not null default 'intelligence' check (item_type in
    ('intelligence', 'report', 'evidence', 'media', 'target', 'summary', 'warning')),
  audience text not null check (audience in ('cid', 'case_members', 'investigator')),
  -- Required for 'case_members'; optional filing context for the other routes.
  target_case_id uuid references public.cases(id) on delete cascade,
  -- Required for 'investigator'.
  target_user_id uuid references public.profiles(id) on delete cascade,
  title text not null,
  -- The snapshot. Immutable once released.
  body text not null,
  handling text not null default 'law_enforcement_sensitive' check (handling in
    ('official_use', 'law_enforcement_sensitive', 'court_disclosable')),
  reason text not null,
  released_by uuid references public.profiles(id),
  released_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id),
  revoke_reason text,
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists siu_disclosures_case_idx on public.siu_disclosures (siu_case_id);
create index if not exists siu_disclosures_target_case_idx on public.siu_disclosures (target_case_id);
create index if not exists siu_disclosures_target_user_idx on public.siu_disclosures (target_user_id);
create index if not exists siu_disclosures_released_by_fkey_idx on public.siu_disclosures (released_by);
create index if not exists siu_disclosures_revoked_by_fkey_idx on public.siu_disclosures (revoked_by);
create index if not exists siu_disclosures_acknowledged_by_fkey_idx on public.siu_disclosures (acknowledged_by);
create index if not exists siu_disclosures_live_idx on public.siu_disclosures (audience) where revoked_at is null;
alter table public.siu_disclosures enable row level security;

-- SIU side only. A CID user reading this table directly gets zero rows, at
-- every rank, which is why the origin can never leak through it.
drop policy if exists siu_disclosures_sel on public.siu_disclosures;
create policy siu_disclosures_sel on public.siu_disclosures
  for select to authenticated using (private.siu_case_read(siu_case_id));

-- No INSERT / UPDATE / DELETE policy anywhere: the RPCs below are the only path.

-- ── The CID-facing read ─────────────────────────────────────────────────────
-- Projects only what CID is allowed to know. No siu_case_id, no
-- source_item_id, no case number, no hint of the investigation's existence
-- beyond "SIU released this". p_case narrows to one CID case file.
create or replace function public.siu_released_intelligence(p_case uuid default null)
returns table (
  id uuid, item_type text, title text, body text, handling text,
  audience text, target_case_id uuid, released_at timestamptz,
  acknowledged_at timestamptz, acknowledged_by uuid
)
language sql stable security definer set search_path to ''
as $$
  select d.id, d.item_type, d.title, d.body, d.handling,
         d.audience, d.target_case_id, d.released_at,
         d.acknowledged_at, d.acknowledged_by
    from public.siu_disclosures d
   where d.revoked_at is null
     and (p_case is null or d.target_case_id = p_case)
     and case d.audience
           when 'cid'          then private.is_active()
           when 'case_members' then private.can_access_case(d.target_case_id)
           when 'investigator' then d.target_user_id = (select auth.uid())
           else false
         end
   order by d.released_at desc
   limit 200
$$;
revoke all on function public.siu_released_intelligence(uuid) from public;
revoke execute on function public.siu_released_intelligence(uuid) from anon;
grant execute on function public.siu_released_intelligence(uuid) to authenticated, service_role;

-- ── Release ─────────────────────────────────────────────────────────────────
create or replace function public.siu_share(
  p_case uuid,
  p_item_type text,
  p_title text,
  p_body text,
  p_audience text,
  p_reason text,
  p_target_case uuid default null,
  p_target_user uuid default null,
  p_source_item uuid default null,
  p_handling text default 'law_enforcement_sensitive'
) returns uuid
language plpgsql security definer set search_path to ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_id uuid;
  v_target record;
begin
  if not private.is_siu_case(p_case) then raise exception 'not an SIU investigation'; end if;
  -- Access to the investigation AND field standing. Oversight cannot release.
  if not (private.siu_case_access(p_case) and private.siu_is_agent()) then
    raise exception 'not authorized';
  end if;
  if p_item_type not in ('intelligence', 'report', 'evidence', 'media', 'target', 'summary', 'warning') then
    raise exception 'unknown release item type';
  end if;
  if p_audience not in ('cid', 'case_members', 'investigator') then
    raise exception 'unknown release audience';
  end if;
  if p_handling not in ('official_use', 'law_enforcement_sensitive', 'court_disclosable') then
    raise exception 'unknown handling caveat';
  end if;
  if coalesce(btrim(p_title), '') = '' then raise exception 'a title is required'; end if;
  if coalesce(btrim(p_body), '') = '' then raise exception 'released content cannot be empty'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;

  -- A release must land somewhere real, and never back inside SIU.
  if p_audience = 'case_members' then
    if p_target_case is null then raise exception 'a target case is required to share with case members'; end if;
  end if;
  if p_target_case is not null then
    if not exists (select 1 from public.cases c where c.id = p_target_case) then
      raise exception 'target case not found';
    end if;
    if private.is_siu_case(p_target_case) then
      raise exception 'releases are addressed to CID; an SIU investigation is not a release target';
    end if;
  end if;
  if p_audience = 'investigator' then
    if p_target_user is null then raise exception 'a target investigator is required'; end if;
    select p.active, coalesce(p.is_system, false) as is_system, p.removed_at
      into v_target from public.profiles p where p.id = p_target_user;
    if not found then raise exception 'target investigator not found'; end if;
    if v_target.is_system or v_target.removed_at is not null or not v_target.active then
      raise exception 'releases can only be addressed to an active member';
    end if;
  end if;

  insert into public.siu_disclosures (
    siu_case_id, source_item_id, item_type, audience, target_case_id, target_user_id,
    title, body, handling, reason, released_by)
  values (
    p_case, p_source_item, p_item_type, p_audience,
    p_target_case,
    case when p_audience = 'investigator' then p_target_user end,
    btrim(p_title), btrim(p_body), p_handling, btrim(p_reason), v_actor)
  returning id into v_id;

  -- The audit row records WHAT was released and to WHOM, never the body: the
  -- released text lives in exactly one place so a revocation means something.
  perform private.siu_audit('SIU_INTEL_RELEASED', p_case, jsonb_build_object(
    'disclosure_id', v_id,
    'item_type',     p_item_type,
    'audience',      p_audience,
    'target_case',   p_target_case,
    'target_user',   case when p_audience = 'investigator' then p_target_user end,
    'handling',      p_handling,
    'title',         btrim(p_title),
    'reason',        btrim(p_reason),
    'released_by',   v_actor));
  return v_id;
end $$;
revoke all on function public.siu_share(uuid, text, text, text, text, text, uuid, uuid, uuid, text) from public;
revoke execute on function public.siu_share(uuid, text, text, text, text, text, uuid, uuid, uuid, text) from anon;
grant execute on function public.siu_share(uuid, text, text, text, text, text, uuid, uuid, uuid, text) to authenticated, service_role;

-- ── Revoke ──────────────────────────────────────────────────────────────────
-- The releasing agent can pull their own release back; SIU command over the
-- investigation can pull anyone's. The row is kept — a revoked disclosure is
-- part of the record of what CID was told and when it stopped being told.
create or replace function public.siu_revoke_disclosure(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path to ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_row record;
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  select d.id, d.siu_case_id, d.released_by, d.revoked_at, d.item_type, d.audience
    into v_row from public.siu_disclosures d where d.id = p_id for update;
  if not found then raise exception 'release not found'; end if;
  if not private.siu_case_access(v_row.siu_case_id) then raise exception 'release not found'; end if;
  if v_row.revoked_at is not null then raise exception 'this release was already revoked'; end if;
  if not (v_row.released_by = v_actor or private.siu_case_command(v_row.siu_case_id)) then
    raise exception 'not authorized';
  end if;

  update public.siu_disclosures
     set revoked_at = now(), revoked_by = v_actor, revoke_reason = btrim(p_reason)
   where id = p_id;

  perform private.siu_audit('SIU_INTEL_REVOKED', v_row.siu_case_id, jsonb_build_object(
    'disclosure_id', p_id, 'item_type', v_row.item_type, 'audience', v_row.audience,
    'reason', btrim(p_reason), 'revoked_by', v_actor));
end $$;
revoke all on function public.siu_revoke_disclosure(uuid, text) from public;
revoke execute on function public.siu_revoke_disclosure(uuid, text) from anon;
grant execute on function public.siu_revoke_disclosure(uuid, text) to authenticated, service_role;

-- ── Acknowledge ─────────────────────────────────────────────────────────────
-- The CID recipient records receipt. Re-checks the audience rule rather than
-- trusting the caller to only acknowledge things addressed to them, so this
-- can never be used as an oracle for a release someone cannot see.
create or replace function public.siu_acknowledge_disclosure(p_id uuid)
returns void
language plpgsql security definer set search_path to ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_row record;
begin
  select d.id, d.siu_case_id, d.audience, d.target_case_id, d.target_user_id,
         d.revoked_at, d.acknowledged_at, d.item_type
    into v_row from public.siu_disclosures d where d.id = p_id for update;
  -- "Not found" is the answer for a release this caller has no business
  -- knowing exists, as well as for one that genuinely does not.
  if not found or v_row.revoked_at is not null then raise exception 'release not found'; end if;
  if not (case v_row.audience
            when 'cid'          then private.is_active()
            when 'case_members' then private.can_access_case(v_row.target_case_id)
            when 'investigator' then v_row.target_user_id = v_actor
            else false
          end) then
    raise exception 'release not found';
  end if;
  if v_row.acknowledged_at is not null then return; end if;

  update public.siu_disclosures
     set acknowledged_at = now(), acknowledged_by = v_actor
   where id = p_id;

  perform private.siu_audit('SIU_INTEL_ACKNOWLEDGED', v_row.siu_case_id, jsonb_build_object(
    'disclosure_id', p_id, 'item_type', v_row.item_type,
    'audience', v_row.audience, 'acknowledged_by', v_actor));
end $$;
revoke all on function public.siu_acknowledge_disclosure(uuid) from public;
revoke execute on function public.siu_acknowledge_disclosure(uuid) from anon;
grant execute on function public.siu_acknowledge_disclosure(uuid) to authenticated, service_role;

-- ============================================================================
-- Rollback: drop the four functions, then `drop table public.siu_disclosures`.
-- Dropping the table destroys the record of what was released to CID and when
-- — export it first if any release has ever been made.
-- ============================================================================
