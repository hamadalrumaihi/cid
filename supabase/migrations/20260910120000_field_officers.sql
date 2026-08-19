-- ============================================================================
-- Field officers: a lower-trust identity that authenticates into the portal
-- WITHOUT becoming a CID member.
--
-- This is the access boundary for the Field Intelligence Submission Portal.
-- It ships before any submission table exists, on purpose: the boundary is
-- the part that can go wrong quietly, and it is worth proving on its own.
--
-- -- The problem this table exists to avoid ----------------------------------
-- private.is_active() is `profiles.active`, and it is a master key. Twenty-two
-- tables grant SELECT on it and nothing else:
--
--   persons, person_relationships, person_vehicles, person_places,
--   vehicles, gangs, gang_members, gang_ranks, gang_places, gang_turf,
--   places, place_process_steps, accounts, account_handles, account_links,
--   indicators, narcotic_hotspots, narcotic_precursors,
--   ballistics_benches, ballistic_footprints, commendations, tickets
--
-- So the obvious implementation -- give a patrol officer profiles.active =
-- true so they can insert a submission -- would hand every trooper the entire
-- intelligence database on their first login: every person of interest, every
-- gang member, every stash house. That is the exact disclosure the Field
-- Intelligence design forbids.
--
-- The other repair, rewriting 45 policies to `is_active() and not
-- is_field_officer()`, was rejected. It is one forgotten policy away from the
-- same leak, and a policy nobody thought about would fail OPEN.
--
-- So a field officer is NOT profiles.active. Their standing lives here
-- instead. Every existing policy is left exactly as it was, and stays shut
-- against them because is_active() is false. A CID table nobody remembered to
-- consider is closed to field officers by construction, not by vigilance.
--
-- -- Dual identity is normal, not an edge case --------------------------------
-- An officer may later join CID. The account is not replaced: a CID profile is
-- activated alongside the field_officers row, so historical submissions stay
-- attributed to the same user_id. Such a person is CID -- profiles.active wins
-- at the gate and they get the investigative portal. is_field_officer() is only
-- ever used to GRANT access to Field Intelligence surfaces, never to deny a CID
-- surface, so holding both identities can never take anything away.
--
-- -- What this migration deliberately does NOT do -----------------------------
-- No submission tables, no portal data, no changes to any existing policy,
-- function or grant. Nothing a field officer can read is added here; they can
-- see their own profile row (profiles_sel already allows id = auth.uid()) and
-- their own standing, and that is all until the submission model lands.
--
-- -- Proof, not assertion ------------------------------------------------------
-- Verified live against the CID project by appointing the dedicated
-- rls-test-inactive account as a SAHP field officer inside a transaction and
-- rolling it back. As that officer:
--
--   is_active=false  is_field_officer=true  agency=SAHP  is_command=false
--   37 tables probed -- persons, vehicles, gangs, gang_members, places,
--   accounts, indicators, narcotics, ballistics, cases, evidence, reports,
--   media, audit_log, siu_memberships, case_charges, legal_requests,
--   observations, targets, operations, notifications, tickets and the rest:
--   NOTHING LEAKED. Every one returned 0 rows or a hard denial.
--   profiles=1 (their own) and field_officers=1 (their own appointment).
--
-- Those zeros mean something because the tables are not empty: 263 persons,
-- 254 gang members, 60 places, 53 gangs, 22 cases, 238 media.
--
-- Writes were probed with GET DIAGNOSTICS row counts, because RLS refuses by
-- matching zero rows rather than by erroring and "no error" proves nothing:
--
--   insert persons / gangs      REFUSED by policy
--   appoint another officer     REFUSED by policy
--   change own agency           0 rows  (silent refusal -- no error raised)
--   self-activate own profile   1 row, resulting active = FALSE
--                               (guard_profile stripped it; the row count
--                                looks like success and is not)
--   assign_field_officer()      'not authorized'
--
-- APPLICATION NOTE: applied live as field_officers, then corrected by
-- field_officers_internal_note_column_grant and
-- field_officers_drop_internal_note. This file is the settled end state those
-- three reached; a rebuild from it produces the same schema in one step.
-- ============================================================================

-- -- The membership -----------------------------------------------------------
-- Shaped after siu_memberships, which is the established pattern here for "a
-- separate authorization domain attached to an account".
create table if not exists public.field_officers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,

  -- The employing agency. A check rather than an enum: agencies are policy,
  -- not schema, and adding one should not need a type migration.
  agency text not null check (agency in ('SAHP', 'BCSO', 'LSPD')),

  -- Identity as the agency records it. These are command-set, NOT self-set --
  -- see the policies below. A submission snapshots from here rather than from
  -- profiles.badge_number, which the account holder can edit themselves.
  callsign text,
  officer_rank text,
  unit text,

  -- Standing. Revocation sets active = false and stamps ended_*; the row is
  -- never deleted, because submissions must stay attributable to a real
  -- appointment even after it ends.
  active boolean not null default true,
  appointed_by uuid references public.profiles(id),
  appointed_at timestamptz not null default now(),
  ended_by uuid references public.profiles(id),
  ended_at timestamptz,
  end_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists field_officers_agency_idx
  on public.field_officers (agency) where active;
create index if not exists field_officers_appointed_by_fkey_idx
  on public.field_officers (appointed_by);
create index if not exists field_officers_ended_by_fkey_idx
  on public.field_officers (ended_by);

alter table public.field_officers enable row level security;

-- -- The helper ---------------------------------------------------------------
-- SECURITY DEFINER so it can be consulted from inside a policy without the
-- caller needing to read the table. Granted to authenticated because policies
-- evaluate as the querying user -- a helper used in a policy and not granted
-- makes the table unreadable, which is a lesson this schema has already paid
-- for once.
create or replace function private.is_field_officer()
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(
    (select f.active from public.field_officers f
      where f.user_id = (select auth.uid())),
    false)
$$;
revoke all on function private.is_field_officer() from public;
grant execute on function private.is_field_officer() to authenticated, service_role;

-- The agency of the calling field officer, or null. Used to stamp submissions
-- from the appointment rather than from anything the client sends.
create or replace function private.field_officer_agency()
returns text language sql stable security definer set search_path to '' as $$
  select f.agency from public.field_officers f
   where f.user_id = (select auth.uid()) and f.active
$$;
revoke all on function private.field_officer_agency() from public;
grant execute on function private.field_officer_agency() to authenticated, service_role;

-- -- Policies ----------------------------------------------------------------
-- SELECT: the officer reads their own appointment (the portal shows their
-- agency and callsign), and CID members read the roster, because a reviewer
-- has to know who submitted a report and from which agency.
drop policy if exists field_officers_sel on public.field_officers;
create policy field_officers_sel on public.field_officers
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_active());

-- Everything else is command. An officer cannot appoint themselves, change
-- their agency, restore their own revoked standing, or edit their callsign
-- into somebody else's -- there is simply no policy that lets them write here.
drop policy if exists field_officers_cmd on public.field_officers;
create policy field_officers_cmd on public.field_officers
  for all to authenticated
  using (private.is_command())
  with check (private.is_command());

-- The table carries no column that needs hiding, so the SELECT grant is plain
-- and RLS alone decides who sees a row.
--
-- It did not start that way, and the reason is worth leaving here. The first
-- draft had an `internal_note` column meant for command, kept out of everyone
-- else's reach with `revoke select (internal_note) ... from authenticated`
-- followed by a column-list grant. A live probe showed the officer reading it
-- anyway: `authenticated` already held a TABLE-level SELECT (from the default
-- privileges that 20260908130000 left in place for that role), and column
-- privileges only ADD to table privileges -- they cannot subtract. Hiding a
-- column requires that the table-level grant not exist at all.
--
-- Revoking it worked, and then locked out the column's only intended audience:
-- command connects as `authenticated` too, so nobody could read the note. A
-- column with no reader is worse than no column, and the note had no consumer
-- yet, so it was dropped. If command notes are wanted later they need a
-- reader designed with them -- most likely a SECURITY DEFINER RPC gated on
-- private.is_command(), not a column grant.
grant select on public.field_officers to authenticated;

-- -- Housekeeping triggers ----------------------------------------------------
drop trigger if exists field_officers_touch on public.field_officers;
create trigger field_officers_touch before update on public.field_officers
  for each row execute function private.touch();

drop trigger if exists field_officers_audit on public.field_officers;
create trigger field_officers_audit after insert or update or delete
  on public.field_officers
  for each row execute function private.audit();

-- -- Provisioning -------------------------------------------------------------
-- Appointment is a command act with its own audit row, rather than a bare
-- table write, so the reason and the appointing officer are recorded together.
-- Re-appointing an existing user updates the row in place: the same account
-- keeps its submission history, which is the point of not issuing shared
-- agency logins.
create or replace function public.assign_field_officer(
  p_user uuid, p_agency text, p_callsign text default null,
  p_rank text default null, p_unit text default null
) returns uuid language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); v_id uuid;
begin
  if not private.is_command() then raise exception 'not authorized'; end if;
  if p_agency not in ('SAHP', 'BCSO', 'LSPD') then
    raise exception 'unknown agency: %', p_agency;
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'no such account -- the officer must sign in once first';
  end if;

  insert into public.field_officers
    (user_id, agency, callsign, officer_rank, unit, appointed_by)
  values (p_user, p_agency, nullif(btrim(coalesce(p_callsign, '')), ''),
          nullif(btrim(coalesce(p_rank, '')), ''),
          nullif(btrim(coalesce(p_unit, '')), ''), v_actor)
  on conflict (user_id) do update
    set agency = excluded.agency,
        callsign = excluded.callsign,
        officer_rank = excluded.officer_rank,
        unit = excluded.unit,
        active = true,
        appointed_by = v_actor,
        appointed_at = now(),
        ended_by = null, ended_at = null, end_reason = null,
        updated_at = now()
  returning id into v_id;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_OFFICER_APPOINTED', 'field_officers', v_id,
          jsonb_build_object('user_id', p_user, 'agency', p_agency,
                             'callsign', p_callsign, 'rank', p_rank, 'unit', p_unit));
  return v_id;
end $$;
revoke all on function public.assign_field_officer(uuid, text, text, text, text) from public;
revoke execute on function public.assign_field_officer(uuid, text, text, text, text) from anon;
grant execute on function public.assign_field_officer(uuid, text, text, text, text)
  to authenticated, service_role;

-- Revocation. Never a delete: the appointment is the provenance of every
-- submission the officer ever made, and deleting it would orphan that.
create or replace function public.end_field_officer(p_user uuid, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); v_id uuid;
begin
  if not private.is_command() then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'ending an appointment needs a reason';
  end if;

  update public.field_officers
     set active = false, ended_by = v_actor, ended_at = now(),
         end_reason = btrim(p_reason), updated_at = now()
   where user_id = p_user and active
  returning id into v_id;
  if v_id is null then raise exception 'that account holds no active appointment'; end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_OFFICER_ENDED', 'field_officers', v_id,
          jsonb_build_object('user_id', p_user, 'reason', btrim(p_reason)));
end $$;
revoke all on function public.end_field_officer(uuid, text) from public;
revoke execute on function public.end_field_officer(uuid, text) from anon;
grant execute on function public.end_field_officer(uuid, text) to authenticated, service_role;

-- -- My own standing ----------------------------------------------------------
-- The portal needs one call that answers "who am I and what may I do". It is
-- SECURITY INVOKER, so it returns exactly what the policies above allow and
-- cannot become a way to read somebody else's appointment.
create or replace function public.my_field_standing()
returns jsonb language sql stable security invoker set search_path to '' as $$
  select coalesce(
    (select jsonb_build_object(
       'agency', f.agency, 'callsign', f.callsign, 'officer_rank', f.officer_rank,
       'unit', f.unit, 'active', f.active, 'appointed_at', f.appointed_at)
       from public.field_officers f where f.user_id = (select auth.uid())),
    'null'::jsonb)
$$;
revoke all on function public.my_field_standing() from public;
revoke execute on function public.my_field_standing() from anon;
grant execute on function public.my_field_standing() to authenticated, service_role;

-- ============================================================================
-- Rollback: drop the two RPCs, private.is_field_officer(),
-- private.field_officer_agency(), and the table. Nothing else references them
-- yet, which is why this migration is safe to ship on its own.
-- ============================================================================
