-- ============================================================================
-- Claim-level verification: deciding about the PARTS of a report, not the whole.
--
-- Priority 5. A field report is several separate assertions, and a reviewer
-- confirming one of them says nothing about the others:
--
--     John Doe                         VERIFIED
--     driving ABC123                   VERIFIED
--     John Doe -> vehicle ABC123       VERIFIED
--     John Doe -> Drenger Blade MC     UNVERIFIED
--     seen at Postal 2025              VERIFIED
--
-- Accepting or rejecting that report as one indivisible thing loses four true
-- claims to protect against one unconfirmed one, or accepts the unconfirmed one
-- to keep the four. Neither is what a reviewer means.
--
-- -- A verdict is a separate table, not a column on the claim ------------------
-- The obvious implementation is a `verdict` column on each of the five child
-- tables. It is wrong here for a specific reason: those tables' UPDATE policy
-- is `field_submission_my_draft`, so a reviewer has no UPDATE on them at all --
-- deliberately, because P4 established that a reviewer must not be able to
-- rewrite the officer's account and then review it. Adding a verdict column
-- would mean granting reviewers UPDATE on the claim rows, and with it the
-- ability to edit the claim text itself.
--
-- So the officer's account stays immutable and a verdict is a SEPARATE
-- assertion ABOUT it, written by someone else, in a table only reviewers can
-- reach. Same shape as the reviewer notes in P4, for the same reason.
--
-- -- Which claim, without a polymorphic key ----------------------------------
-- Five nullable foreign keys with `num_nonnulls(...) = 1`, matching
-- field_submission_evidence. A single `claim_id uuid` with a `claim_kind` text
-- would be shorter and would have no referential integrity at all: a deleted
-- claim would leave a verdict pointing at nothing, and nothing would notice.
-- Here the cascade takes the verdict with the claim.
--
-- -- Verdicts are reviewer-only, for now ---------------------------------------
-- The officer sees their report's overall status and the thread; they do not
-- see which individual claims were confirmed. That is the conservative reading:
-- "John Doe -> Drenger Blade MC: UNVERIFIED" tells the reporting officer
-- something about what CID does and does not have on file. Exposing it later is
-- one policy line; un-exposing it is not.
--
-- -- Evidence attached is NOT verified ----------------------------------------
-- There is no path here from "this claim has a photo" to a verdict. A verdict
-- is a person's judgement, recorded with their name on it. The design says
-- these are different and this keeps them different.
--
-- APPLICATION NOTE: applied live as field_claim_verdicts.
-- ============================================================================

create table if not exists public.field_claim_verdicts (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.field_submissions(id) on delete cascade,

  -- Exactly one of these. The cascade means a verdict cannot outlive its claim.
  person_id uuid references public.field_submission_persons(id) on delete cascade,
  vehicle_id uuid references public.field_submission_vehicles(id) on delete cascade,
  org_id uuid references public.field_submission_orgs(id) on delete cascade,
  location_id uuid references public.field_submission_locations(id) on delete cascade,
  item_id uuid references public.field_submission_items(id) on delete cascade,

  -- verified    the reviewer confirmed it against what CID holds
  -- unverified  useful, but not confirmed. NOT the same as wrong.
  -- disputed    something CID holds contradicts it
  -- rejected    should not be treated as intelligence
  verdict text not null check (verdict in ('verified', 'unverified', 'disputed', 'rejected')),

  -- Reviewer-private, like every other note in this system.
  note text,

  decided_by uuid references public.profiles(id),
  decided_at timestamptz not null default now(),

  constraint field_claim_verdicts_one_claim
    check (num_nonnulls(person_id, vehicle_id, org_id, location_id, item_id) = 1)
);

-- One current verdict per claim. Partial unique indexes rather than a single
-- constraint, because the key is spread across five nullable columns.
create unique index if not exists field_claim_verdicts_person_uk
  on public.field_claim_verdicts (person_id) where person_id is not null;
create unique index if not exists field_claim_verdicts_vehicle_uk
  on public.field_claim_verdicts (vehicle_id) where vehicle_id is not null;
create unique index if not exists field_claim_verdicts_org_uk
  on public.field_claim_verdicts (org_id) where org_id is not null;
create unique index if not exists field_claim_verdicts_location_uk
  on public.field_claim_verdicts (location_id) where location_id is not null;
create unique index if not exists field_claim_verdicts_item_uk
  on public.field_claim_verdicts (item_id) where item_id is not null;

create index if not exists field_claim_verdicts_submission_idx
  on public.field_claim_verdicts (submission_id);

alter table public.field_claim_verdicts enable row level security;

-- Reviewers only. There is deliberately no branch for the submitting officer.
drop policy if exists field_claim_verdicts_sel on public.field_claim_verdicts;
create policy field_claim_verdicts_sel on public.field_claim_verdicts
  for select to authenticated using (private.is_active());

-- No INSERT or UPDATE policy at all: verdicts are recorded only through
-- field_claim_decide(), which audits. A direct write would be an unrecorded
-- judgement about somebody, which is the one thing this table exists to avoid.
drop policy if exists field_claim_verdicts_del on public.field_claim_verdicts;
create policy field_claim_verdicts_del on public.field_claim_verdicts
  for delete to authenticated using (private.is_command());

drop trigger if exists field_claim_verdicts_audit on public.field_claim_verdicts;
create trigger field_claim_verdicts_audit after insert or update or delete
  on public.field_claim_verdicts
  for each row execute function private.audit();

-- -- Recording a verdict --------------------------------------------------------
-- Upsert, so changing your mind about a claim replaces the verdict rather than
-- accumulating contradictory ones -- and every change lands in the audit log
-- with what it was before.
create or replace function public.field_claim_decide(
  p_kind text, p_claim uuid, p_verdict text, p_note text default null)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_submission uuid; v_prev text; v_id uuid;
begin
  if not private.is_active() then raise exception 'not authorized'; end if;
  if p_verdict not in ('verified', 'unverified', 'disputed', 'rejected') then
    raise exception 'unknown verdict: %', p_verdict;
  end if;

  -- Resolve the claim to its submission. This is also the existence check: a
  -- claim id that belongs to nothing gets no verdict.
  v_submission := case p_kind
    when 'person'   then (select submission_id from public.field_submission_persons where id = p_claim)
    when 'vehicle'  then (select submission_id from public.field_submission_vehicles where id = p_claim)
    when 'org'      then (select submission_id from public.field_submission_orgs where id = p_claim)
    when 'location' then (select submission_id from public.field_submission_locations where id = p_claim)
    when 'item'     then (select submission_id from public.field_submission_items where id = p_claim)
    else null end;
  if v_submission is null then
    raise exception 'no such claim: % %', p_kind, p_claim;
  end if;

  -- A draft has not been sent. Judging one would mean reading somebody's
  -- unfinished notes, which the SELECT policies already forbid.
  if (select status from public.field_submissions where id = v_submission) = 'draft' then
    raise exception 'that report has not been sent yet';
  end if;

  select id, verdict into v_id, v_prev from public.field_claim_verdicts
   where (p_kind = 'person'   and person_id   = p_claim)
      or (p_kind = 'vehicle'  and vehicle_id  = p_claim)
      or (p_kind = 'org'      and org_id      = p_claim)
      or (p_kind = 'location' and location_id = p_claim)
      or (p_kind = 'item'     and item_id     = p_claim);

  if v_id is null then
    insert into public.field_claim_verdicts
      (submission_id, person_id, vehicle_id, org_id, location_id, item_id,
       verdict, note, decided_by)
    values (v_submission,
            case when p_kind = 'person'   then p_claim end,
            case when p_kind = 'vehicle'  then p_claim end,
            case when p_kind = 'org'      then p_claim end,
            case when p_kind = 'location' then p_claim end,
            case when p_kind = 'item'     then p_claim end,
            p_verdict, nullif(btrim(coalesce(p_note, '')), ''), v_actor);
  else
    update public.field_claim_verdicts
       set verdict = p_verdict,
           note = nullif(btrim(coalesce(p_note, '')), ''),
           decided_by = v_actor, decided_at = now()
     where id = v_id;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_CLAIM_DECIDED', 'field_claim_verdicts', v_submission,
          jsonb_build_object('claim_kind', p_kind, 'claim_id', p_claim,
                             'from_verdict', v_prev, 'to_verdict', p_verdict));
end $$;
revoke all on function public.field_claim_decide(text, uuid, text, text) from public;
revoke execute on function public.field_claim_decide(text, uuid, text, text) from anon;
grant execute on function public.field_claim_decide(text, uuid, text, text)
  to authenticated, service_role;

-- -- How far along a report's review is ----------------------------------------
-- SECURITY INVOKER, so it counts exactly what the caller may see and cannot
-- become a way to learn about a report somebody is not entitled to.
create or replace function public.field_claim_progress(p_submission uuid)
returns jsonb language sql stable security invoker set search_path to '' as $$
  with claims as (
    select id from public.field_submission_persons   where submission_id = p_submission
    union all select id from public.field_submission_vehicles  where submission_id = p_submission
    union all select id from public.field_submission_orgs      where submission_id = p_submission
    union all select id from public.field_submission_locations where submission_id = p_submission
    union all select id from public.field_submission_items     where submission_id = p_submission
  ), decided as (
    select verdict from public.field_claim_verdicts where submission_id = p_submission
  )
  select jsonb_build_object(
    'claims',     (select count(*) from claims),
    'decided',    (select count(*) from decided),
    'verified',   (select count(*) from decided where verdict = 'verified'),
    'unverified', (select count(*) from decided where verdict = 'unverified'),
    'disputed',   (select count(*) from decided where verdict = 'disputed'),
    'rejected',   (select count(*) from decided where verdict = 'rejected'))
$$;
revoke all on function public.field_claim_progress(uuid) from public;
revoke execute on function public.field_claim_progress(uuid) from anon;
grant execute on function public.field_claim_progress(uuid) to authenticated, service_role;

-- ============================================================================
-- Rollback: drop field_claim_progress(), field_claim_decide() and the table.
-- ============================================================================
