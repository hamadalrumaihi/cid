-- ─────────────────────────────────────────────────────────────────────────────
-- Gang roster becomes person-first: a member IS a person↔gang relationship.
--
-- The roster was a free-text list — gang_members.name was NOT NULL and
-- person_id was an optional afterthought, so 243 of 245 rows were typed names
-- with no link to the Persons registry. This flips it: identity comes from the
-- linked Person, and the typed name survives only as a historical snapshot.
--
--   • name becomes NULLABLE (identity now lives on the Person; name is kept
--     as an audit snapshot of what was typed / who was picked).
--   • new relationship columns: confidence, joined_at, left_at, note,
--     created_by, reviewed_by, reviewed_at.
--   • status adopts a fixed relationship vocabulary (the placeholder
--     'At Large' every row carried is normalized to 'Under review' first, so
--     the CHECK holds); a person can hold at most ONE active membership per
--     gang (partial unique index — 'Former member' is the inactive state).
--   • gang_member_add(): the person-first entry point — it resolves the name
--     snapshot from the Person, refuses a merged person, and refuses a second
--     active membership, so "adding the member" and "linking the person" are
--     one atomic step. Authority mirrors gang_members_ins (any active member).
--
-- The one-time link/merge/create backfill of the 245 existing rows is applied
-- separately as data (it name-matches live Persons and is not replay-safe on a
-- fresh DB); this migration is schema + RPC + the status normalization only.
-- ─────────────────────────────────────────────────────────────────────────────

-- Identity moves to the Person; the typed name is now an optional snapshot.
alter table public.gang_members alter column name drop not null;

-- Relationship metadata (the roster edge, not the person's identity).
alter table public.gang_members
  add column if not exists confidence  text,
  add column if not exists joined_at    date,
  add column if not exists left_at      date,
  add column if not exists note         text,
  add column if not exists created_by   uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_by  uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at  timestamptz;

-- Normalize the placeholder status ('At Large' on every legacy row, or NULL)
-- to a real relationship state BEFORE the vocabulary CHECK is added.
update public.gang_members
  set status = 'Under review'
  where status is null
     or status not in ('Confirmed member','Probable member','Associate','Former member','Leadership','Under review','Disputed');

alter table public.gang_members
  add constraint gang_members_status_vocab
  check (status is null or status in
    ('Confirmed member','Probable member','Associate','Former member','Leadership','Under review','Disputed'));

-- One active membership per person per gang. 'Former member' is the inactive
-- state and is exempt, so history (rejoining after leaving) stays representable.
create unique index if not exists gang_members_one_active_per_person
  on public.gang_members (gang_id, person_id)
  where person_id is not null and status is distinct from 'Former member';

-- ── person-first entry point ────────────────────────────────────────────────
create or replace function public.gang_member_add(
  p_gang uuid,
  p_person uuid,
  p_rank text default null,
  p_callsign text default null,
  p_status text default 'Under review',
  p_confidence text default null,
  p_note text default null,
  p_case uuid default null
) returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_name text;
  v_id uuid;
begin
  if v_uid is null or not private.is_active() then
    raise exception 'gang_member_add: not authorized';
  end if;
  -- Identity comes from the Person; a merged tombstone is never a member.
  select name into v_name from public.persons
    where id = p_person and lifecycle is distinct from 'merged';
  if v_name is null then
    raise exception 'gang_member_add: person not found or merged';
  end if;
  if p_status is not null and p_status not in
    ('Confirmed member','Probable member','Associate','Former member','Leadership','Under review','Disputed') then
    raise exception 'gang_member_add: invalid status %', p_status;
  end if;
  -- Duplicate prevention beyond the unique index, with a readable message.
  if exists (
    select 1 from public.gang_members
    where gang_id = p_gang and person_id = p_person
      and status is distinct from 'Former member'
  ) then
    raise exception 'gang_member_add: this person is already on the gang roster';
  end if;
  insert into public.gang_members
    (gang_id, person_id, name, rank, callsign, status, confidence, note, case_id, created_by)
  values
    (p_gang, p_person, v_name, nullif(btrim(coalesce(p_rank,'')),''),
     nullif(btrim(coalesce(p_callsign,'')),''), coalesce(p_status,'Under review'),
     nullif(btrim(coalesce(p_confidence,'')),''), nullif(btrim(coalesce(p_note,'')),''),
     p_case, v_uid)
  returning id into v_id;
  return v_id;
end
$function$;

revoke all on function public.gang_member_add(uuid,uuid,text,text,text,text,text,uuid) from public;
revoke all on function public.gang_member_add(uuid,uuid,text,text,text,text,text,uuid) from anon;
grant execute on function public.gang_member_add(uuid,uuid,text,text,text,text,text,uuid) to authenticated, service_role;
