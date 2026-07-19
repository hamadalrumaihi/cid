-- ─────────────────────────────────────────────────────────────────────────────
-- Gang roster lifecycle: edit / review / retire go through RPCs.
--
-- 20260807170000 made the roster person-first and added gang_member_add, but
-- editing a member still went through a raw table UPDATE from the modal. That
-- left three gaps this migration closes:
--
--   • Review is unrecorded. reviewed_by / reviewed_at exist but nothing stamped
--     them, so command could not tell a triaged row from an untouched import
--     (247 rows sit at 'Under review' with 0 reviewed). gang_member_review and
--     the mark_reviewed flag on gang_member_update stamp the reviewer + time.
--   • Retirement is unmanaged. 'Former member' is the inactive state the partial
--     unique index exempts, but nothing set left_at when a member left, and a
--     rejoin (Former → active) that collided with a live membership raised a
--     bare 23505. gang_member_update stamps left_at on departure, clears it on
--     return, and raises a readable error on a rejoin collision.
--   • The column default is stale. status still defaulted to 'At Large', which
--     is NOT in the vocabulary CHECK added in 20260807170000 — so any raw insert
--     relying on the default would fail the constraint. Repointed to a valid
--     default ('Under review').
--
-- Authority mirrors gang_members_ins/_upd: any active member (private.is_active).
-- ─────────────────────────────────────────────────────────────────────────────

-- Stale column default would violate the vocabulary CHECK on a raw insert.
alter table public.gang_members alter column status set default 'Under review';

-- ── full relationship edit (the modal's Save) ───────────────────────────────
-- Overwrites the editable relationship fields (identity stays fixed on the
-- Person). status drives the departure lifecycle; p_mark_reviewed stamps the
-- review in the same call.
create or replace function public.gang_member_update(
  p_member uuid,
  p_rank text default null,
  p_callsign text default null,
  p_status text default null,
  p_confidence text default null,
  p_note text default null,
  p_case uuid default null,
  p_joined_at date default null,
  p_left_at date default null,
  p_mark_reviewed boolean default false
) returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_gang uuid;
  v_person uuid;
  v_cur_status text;
  v_status text;
  v_left date;
begin
  if v_uid is null or not private.is_active() then
    raise exception 'gang_member_update: not authorized';
  end if;
  select gang_id, person_id, status into v_gang, v_person, v_cur_status
    from public.gang_members where id = p_member;
  if not found then
    raise exception 'gang_member_update: member not found';
  end if;
  -- Effective status: an explicit value wins, otherwise the row keeps its own.
  v_status := coalesce(p_status, v_cur_status);
  if v_status is not null and v_status not in
    ('Confirmed member','Probable member','Associate','Former member','Leadership','Under review','Disputed') then
    raise exception 'gang_member_update: invalid status %', v_status;
  end if;
  if v_status = 'Former member' then
    -- Departure: stamp a leave date (caller-supplied or today).
    v_left := coalesce(p_left_at, current_date);
  else
    -- Active/return: a member is not "gone", and cannot double up on one gang.
    v_left := null;
    if v_person is not null and exists (
      select 1 from public.gang_members
      where gang_id = v_gang and person_id = v_person and id <> p_member
        and status is distinct from 'Former member'
    ) then
      raise exception 'gang_member_update: this person already has an active membership in this gang';
    end if;
  end if;
  update public.gang_members set
    rank        = nullif(btrim(coalesce(p_rank,'')),''),
    callsign    = nullif(btrim(coalesce(p_callsign,'')),''),
    status      = v_status,
    confidence  = nullif(btrim(coalesce(p_confidence,'')),''),
    note        = nullif(btrim(coalesce(p_note,'')),''),
    case_id     = p_case,
    joined_at   = p_joined_at,
    left_at     = v_left,
    reviewed_by = case when p_mark_reviewed then v_uid else reviewed_by end,
    reviewed_at = case when p_mark_reviewed then now() else reviewed_at end,
    updated_at  = now()
  where id = p_member;
end
$function$;

-- ── one-click review (the roster's quick-triage action) ─────────────────────
-- Stamps the review and optionally confirms a status/confidence in one call,
-- without disturbing rank/callsign/note/case. Never used to retire a member —
-- that goes through gang_member_update — so it applies the active-dup guard but
-- not the departure branch.
create or replace function public.gang_member_review(
  p_member uuid,
  p_status text default null,
  p_confidence text default null
) returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_gang uuid;
  v_person uuid;
begin
  if v_uid is null or not private.is_active() then
    raise exception 'gang_member_review: not authorized';
  end if;
  select gang_id, person_id into v_gang, v_person
    from public.gang_members where id = p_member;
  if not found then
    raise exception 'gang_member_review: member not found';
  end if;
  if p_status is not null and p_status not in
    ('Confirmed member','Probable member','Associate','Former member','Leadership','Under review','Disputed') then
    raise exception 'gang_member_review: invalid status %', p_status;
  end if;
  if p_status = 'Former member' then
    raise exception 'gang_member_review: use gang_member_update to retire a member';
  end if;
  -- Confirming a status must not create a second active membership.
  if p_status is not null and v_person is not null and exists (
    select 1 from public.gang_members
    where gang_id = v_gang and person_id = v_person and id <> p_member
      and status is distinct from 'Former member'
  ) then
    raise exception 'gang_member_review: this person already has an active membership in this gang';
  end if;
  update public.gang_members set
    status      = coalesce(p_status, status),
    confidence  = coalesce(nullif(btrim(coalesce(p_confidence,'')),''), confidence),
    reviewed_by = v_uid,
    reviewed_at = now(),
    updated_at  = now()
  where id = p_member;
end
$function$;

revoke all on function public.gang_member_update(uuid,text,text,text,text,text,uuid,date,date,boolean) from public;
revoke all on function public.gang_member_update(uuid,text,text,text,text,text,uuid,date,date,boolean) from anon;
grant execute on function public.gang_member_update(uuid,text,text,text,text,text,uuid,date,date,boolean) to authenticated, service_role;

revoke all on function public.gang_member_review(uuid,text,text) from public;
revoke all on function public.gang_member_review(uuid,text,text) from anon;
grant execute on function public.gang_member_review(uuid,text,text) to authenticated, service_role;
