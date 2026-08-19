-- ============================================================================
-- Field Intelligence is an access class, not a bureau.
--
-- THE BUG
-- profiles.division defaulted to 'JTF' and profiles.role to 'detective'. Those
-- defaults predate Field Intelligence and were meant as "unassigned" -- but
-- they are not unassigned, they are a bureau and a rank. Every account that has
-- ever signed in therefore reads as a JTF Detective in the roster, including a
-- BCSO deputy who only ever wanted to send CID a photo. Nothing was GRANTED by
-- it (active = false gates every investigative table), but the portal was
-- telling the truth about nothing: it said JTF because a column default said
-- JTF.
--
-- THE FIX
-- Both columns become nullable with no default. An account that nobody has
-- assigned anything to now has no bureau and no rank, which is the fact.
-- Assignment stays exactly where it was: command sets them, the freeze trigger
-- still refuses a client write, and every helper already tolerates null
-- (roleLabel/bureauLabel/isCommandRole take `string | null` and
-- private.is_command() / can_access_case compare with `=`, which is false for
-- null). JTF remains what it always was -- a joint-case designation somebody
-- chooses -- and stops being where unclassified accounts land.
--
-- AND NO APPROVAL QUEUE FOR INFORMATION-ONLY ACCESS
-- Asking to send CID information is not asking for a job. field_access_request
-- put a patrol officer in a queue behind a human decision, and the decision was
-- always going to be yes: the access grants nothing except the ability to write
-- a report addressed to CID. field_access_self_serve() creates the standing
-- immediately.
--
-- That is safe because of what the standing IS, not because somebody checked
-- it: a field officer is not profiles.active, so all 22 is_active()-gated
-- intelligence tables stay shut, they cannot read another officer's submission,
-- and the review queue, claim verdicts, matching and the SIU surfaces all
-- refuse them. Approval was never the boundary. The boundary is the access
-- class, and it is unchanged by this migration.
--
-- The request queue is kept, not dropped: rows already filed are history, a
-- decision RPC that still answers them is better than a stranded queue, and
-- command may still appoint somebody administratively.
-- ============================================================================

-- -- No more JTF-by-default ----------------------------------------------------
alter table public.profiles alter column division drop default;
alter table public.profiles alter column division drop not null;
alter table public.profiles alter column role drop default;
alter table public.profiles alter column role drop not null;

-- Clear the accounts that carry the untouched defaults and nothing else: never
-- activated, never removed, never the subject of a role decision. For those
-- rows 'JTF'/'detective' was never anybody's judgement, it was the column
-- speaking. Every account that HAS a recorded decision keeps what it says --
-- including removed members, whose last bureau and rank are history.
update public.profiles p
   set division = null, role = null, updated_at = now()
 where not p.active
   and p.removed_at is null
   and not p.is_owner
   and not p.is_system
   and p.division = 'JTF'
   and p.role = 'detective'
   and not exists (select 1 from public.role_events e where e.target_id = p.id);

-- -- Standing without a queue ---------------------------------------------------
-- Creates the appointment the applicant described. It is deliberately NOT
-- assign_field_officer(): that one is command's tool and stamps appointed_by,
-- and a self-served appointment has no appointer. Both write the same table and
-- both audit, so the roster still shows one list of field officers with an
-- honest provenance column.
create or replace function public.field_access_self_serve(
  p_agency text,
  p_callsign text default null,
  p_rank text default null,
  p_unit text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_profile public.profiles;
  v_id uuid;
begin
  if v_actor is null then raise exception 'not signed in'; end if;

  select * into v_profile from public.profiles where id = v_actor;
  if not found then raise exception 'no such account'; end if;

  -- A denied account cannot walk back in through the side door. This is the
  -- one refusal that genuinely matters here: everything else on this path is
  -- about not wasting somebody's time, but self-service access with no check
  -- against login_denied would undo a command decision.
  if v_profile.login_denied then
    raise exception 'this account has been denied access to the portal';
  end if;
  if v_profile.removed_at is not null then
    raise exception 'this account has been removed from the portal';
  end if;

  if private.is_active() then
    raise exception 'your account already has portal access';
  end if;
  if private.is_field_officer() then
    raise exception 'you already have Field Intelligence access';
  end if;

  if p_agency not in ('SAHP', 'BCSO', 'LSPD') then
    raise exception 'choose your agency';
  end if;

  insert into public.field_officers
    (user_id, agency, callsign, officer_rank, unit, active)
  values (v_actor, p_agency,
          nullif(btrim(coalesce(p_callsign, '')), ''),
          nullif(btrim(coalesce(p_rank, '')), ''),
          nullif(btrim(coalesce(p_unit, '')), ''),
          true)
  on conflict (user_id) do update
     set agency = excluded.agency,
         callsign = excluded.callsign,
         officer_rank = excluded.officer_rank,
         unit = excluded.unit,
         active = true,
         ended_at = null, ended_by = null, end_reason = null,
         updated_at = now()
  returning id into v_id;

  -- Somebody who had asked and then took the immediate path is no longer
  -- waiting on anybody. Marked withdrawn rather than approved, because nobody
  -- decided it -- writing 'approved' would put a decision in the record that
  -- no human made.
  update public.field_access_requests
     set status = 'withdrawn',
         decision_reason = 'Superseded: the officer created access directly.',
         updated_at = now()
   where user_id = v_actor and status = 'pending';

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_ACCESS_SELF_SERVED', 'field_officers', v_id,
          jsonb_build_object('agency', p_agency,
                             'callsign', nullif(btrim(coalesce(p_callsign, '')), ''),
                             'rank', nullif(btrim(coalesce(p_rank, '')), ''),
                             'unit', nullif(btrim(coalesce(p_unit, '')), '')));

  return jsonb_build_object('id', v_id, 'agency', p_agency);
end $$;
revoke all on function public.field_access_self_serve(text, text, text, text) from public;
revoke execute on function public.field_access_self_serve(text, text, text, text) from anon;
grant execute on function public.field_access_self_serve(text, text, text, text)
  to authenticated, service_role;

-- -- The reporting identity is not self-editable ---------------------------------
-- field_officers already has no UPDATE policy for `authenticated` -- every
-- write goes through a definer RPC -- so an officer cannot promote themselves
-- from BCSO Deputy to SAHP Command after the fact. This makes that explicit
-- rather than incidental, and it is what keeps the snapshot on every historical
-- submission honest: snap_agency / snap_callsign / snap_rank / snap_unit are
-- copied from this row at submit time and never change afterwards.
revoke update on public.field_officers from authenticated;

-- ============================================================================
-- Rollback: restore the defaults (alter column division set default 'JTF',
-- set not null; role set default 'detective', set not null -- both require
-- backfilling the nulled rows first), drop field_access_self_serve(), and
-- re-grant update on public.field_officers to authenticated.
-- ============================================================================
