-- ============================================================================
-- CID BUREAU RESTRUCTURE
-- ----------------------------------------------------------------------------
-- Applied to the live project via MCP in ordered chunks (see
-- MIGRATION-HISTORY.md: bureau_restructure_core .. bureau_restructure_*); this
-- file is the consolidated record of that content.
-- ----------------------------------------------------------------------------
-- The Criminal Investigations Division is reorganized from the geographic
-- bureau model (LSB — Los Santos, BCB — Blaine County, SAB — State) into a
-- functional model:
--
--   Criminal Investigations Division
--   ├── Major Crimes Bureau            (major_crimes,           prefix MCB)
--   ├── Street Crimes Bureau           (street_crimes,          prefix SCB)
--   └── Special Investigations Bureau  (special_investigations, prefix SIB)
--
-- plus JTF, which remains the temporary joint-case designation and the
-- pre-approval profile default (it was never a permanent bureau and is not
-- part of this removal).
--
-- The Special Investigations Unit (SIU) is renamed to the Special
-- Investigations Bureau (SIB). This is a terminology change only: the
-- compartmentalization model (case_authority = 'siu', siu_* tables and
-- helpers, membership via siu_memberships, the X-1 command structure, the
-- separate AG legal path) is preserved unchanged. Internal identifiers keep
-- the historical siu_/'siu' spelling — they are plumbing, not organizational
-- vocabulary — while every user-facing string now says SIB.
--
-- Mechanics:
--   * public.bureau enum values are RENAMED in place (LSB→major_crimes,
--     BCB→street_crimes, SAB→special_investigations). A rename preserves the
--     value identity, so every enum-typed row, CHECK constraint, default and
--     policy follows atomically. Ex-SAB rows are then redistributed to their
--     true new bureau (SAB does not map 1:1 to either new bureau).
--   * role_events history columns are frozen as text BEFORE the rename so
--     member history keeps reading "SAB"/"LSB"/"BCB" — historical facts —
--     instead of silently becoming new-bureau labels.
--   * Existing case numbers are PRESERVED (reports, legal request versions,
--     notifications and audit entries reference them textually — renumbering
--     would break those references). New cases mint MCB-/SCB-/SIB- numbers.
--     private.legal_resolve_bureau still understands legacy LSB-/BCB-
--     prefixes as derivation hints (a preserved identifier, not a live
--     bureau value).
--   * SIB-native cases (case_authority='siu' with no siu_assumed_at) now
--     carry bureau='special_investigations' instead of the old 'JTF'
--     placeholder. A CID case under SIB control keeps its CID bureau. A new
--     CHECK guarantees bureau='special_investigations' implies
--     case_authority='siu', and private.can_create_case refuses it for the
--     normal insert path, so the value can never leak into normal CID use.
--     RLS is unaffected: SIU-authority cases are gated exclusively by the
--     siu_* helpers, never by bureau.
--
-- Member migration (division values):
--   * ex-LSB  → major_crimes by rename; members whose casework is street-
--     level (gang/narcotics/firearms enterprise cases) are moved to
--     street_crimes explicitly.
--   * ex-BCB  → street_crimes by rename (all BCB casework is street-level).
--   * ex-SAB  → redistributed per case signal; command staff (DD+/Owner) and
--     the leads of the violent-crime cases land in major_crimes; members
--     with no case signal default to street_crimes and are surfaced to
--     command for review via notification (see the end of this migration).
--   * SIU personnel keep their siu_memberships (that IS the SIB membership)
--     and their CID division where they are dual-hatted command.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Freeze member-history divisions as text (before the enum rename).
-- ----------------------------------------------------------------------------
alter table public.role_events alter column old_division type text using old_division::text;
alter table public.role_events alter column new_division type text using new_division::text;

-- ----------------------------------------------------------------------------
-- 2. Rename the enum values.
-- ----------------------------------------------------------------------------
alter type public.bureau rename value 'LSB' to 'major_crimes';
alter type public.bureau rename value 'BCB' to 'street_crimes';
alter type public.bureau rename value 'SAB' to 'special_investigations';

-- ----------------------------------------------------------------------------
-- 3. Redistribute ex-SAB rows (now temporarily labeled special_investigations)
--    and correct the ex-LSB rows whose work is street-level.
-- ----------------------------------------------------------------------------

-- Ex-SAB members → Major Crimes: command staff, the removed lead who ran the
-- violent-crime caseload, and the owner accounts.
update public.profiles set division = 'major_crimes'
 where division = 'special_investigations'
   and id in (
    '6554181a-e2ed-4993-a66f-420c08f1471c', -- H K (owner, removed)
    '3a41751b-02fc-4a5b-b36a-fef8a3f1e63f', -- jack crow (Director)
    'de727b21-52a8-4802-8ab5-306fd3970d8b', -- Oliver Ocho (Director)
    'b7b48624-2ba4-4d65-83b0-4bc934b4540d', -- RLS Test Director
    '25466146-c512-4497-8ee8-88cbf3b1d22d', -- Tom wood (Director, Owner)
    '56bbe203-6ccd-49ed-b73d-f2829427c548', -- drake hayes (lead, removed; led the homicide/ambush cases)
    'd0f92ed9-45ee-4d28-b915-726ae4073bd1', -- Mike Harper (Deputy Director)
    'f2b82051-9346-41a6-a48a-96d1a7b3a49f'  -- RLS Test Owner
  );

-- Ex-SAB members → Street Crimes: everyone with street-level case signal,
-- plus members with no case signal (defaulted; surfaced for command review).
update public.profiles set division = 'street_crimes'
 where division = 'special_investigations';

-- Ex-LSB members whose casework is street-level (gang/narcotics/firearms
-- enterprise cases) move from the renamed major_crimes to street_crimes.
update public.profiles set division = 'street_crimes'
 where division = 'major_crimes'
   and id in (
    '961166f6-2882-47ab-b8c1-ae69bdf261cd', -- undeadsam1yt
    'e9e487e5-e9fc-487b-9926-0f27a01bbf8f', -- Amara Popkins (leads 3 street-level cases)
    '433dee0c-3653-439e-ad4a-3b94dec50000'  -- blazemarcus
  );


do $chk$ begin
  if exists (select 1 from public.profiles where division = 'special_investigations') then
    raise exception 'bureau restructure: profiles still assigned to special_investigations after redistribution';
  end if;
end $chk$;

-- Cases. Bureau follows the nature of the investigation; existing case
-- numbers are preserved (see header).

-- Major Crimes: violent / incident-driven investigations.
update public.cases set bureau = 'major_crimes'
 where case_number in ('SAB-9000009',  -- Battle Axe Stabbing at SAHP Station
                       'SAB-9000018',  -- Multi-Scene Coordinated Armed Incident
                       'SAB-9000026',  -- santos gang block ambush (armed incidents)
                       'SAB-9000032',  -- Homicide investigation
                       'SAB-9000033'); -- Officer-Involved Ambush

-- Street Crimes: gang / narcotics / firearms enterprise and proactive work.
update public.cases set bureau = 'street_crimes'
 where bureau = 'special_investigations'  -- remaining ex-SAB caseload
    or case_number in ('LSB-1000001',  -- Miyzuki (gang/drug enterprise)
                       'LSB-1000002',  -- Nolimits (gang enterprise)
                       'LSB-1000003'); -- Sting Opp: VDM Gun Runners

-- SIB-native investigations now carry their own bureau.
update public.cases set bureau = 'special_investigations'
 where case_authority = 'siu' and siu_assumed_at is null;

-- Originating bureau (legal-routing origin for JTF/SIB-assigned cases)
-- follows the redistribution.
update public.cases set originating_bureau = 'street_crimes'
 where case_number in ('SAB-9000022', 'JTF-9000037', 'LSB-1000003');
update public.cases set originating_bureau = 'major_crimes'
 where case_number in ('SIU-8000001', 'SIU-8000003');  -- creator's bureau at origin

do $chk$ begin
  if exists (select 1 from public.cases
              where bureau = 'special_investigations' and case_authority <> 'siu') then
    raise exception 'bureau restructure: non-SIB case assigned to special_investigations';
  end if;
  if exists (select 1 from public.cases where originating_bureau = 'special_investigations') then
    raise exception 'bureau restructure: originating_bureau still special_investigations';
  end if;
end $chk$;


-- Legal requests route with their case's new bureau.
update public.legal_requests r
   set responsible_bureau = case
         when c.bureau in ('major_crimes', 'street_crimes') then c.bureau
         when c.originating_bureau in ('major_crimes', 'street_crimes') then c.originating_bureau
         else 'street_crimes'
       end
  from public.cases c
 where c.id = r.case_id and r.responsible_bureau = 'special_investigations';

-- Membership requests: ex-SAB requested/decided values follow where the
-- applicant actually landed.
update public.membership_requests mr
   set requested_bureau = coalesce(
         (select p.division from public.profiles p
           where p.id = mr.applicant_id and p.division in ('major_crimes', 'street_crimes')),
         'street_crimes')
 where mr.requested_bureau = 'special_investigations';
update public.membership_requests mr
   set decided_bureau = coalesce(
         (select p.division from public.profiles p
           where p.id = mr.applicant_id and p.division in ('major_crimes', 'street_crimes')),
         'street_crimes')
 where mr.decided_bureau = 'special_investigations';

-- Legacy transfer_requests rows (all completed): every ex-SAB destination
-- corresponds to a member who landed in Street Crimes.
update public.transfer_requests set to_bureau = 'street_crimes' where to_bureau = 'special_investigations';
update public.transfer_requests set from_bureau = 'street_crimes' where from_bureau = 'special_investigations';

-- Operations: the single multi-bureau operation had all three old bureaus
-- participating with an SAB lead; under the new model it is a Major Crimes +
-- Street Crimes operation led by Street Crimes.
delete from public.operation_bureaus ob
 where ob.bureau = 'special_investigations'
   and exists (select 1 from public.operation_bureaus x
                where x.operation_id = ob.operation_id and x.bureau = 'street_crimes');
update public.operation_bureaus set bureau = 'street_crimes' where bureau = 'special_investigations';
update public.operations set lead_bureau = 'street_crimes' where lead_bureau = 'special_investigations';
update public.operations set bureau = 'street_crimes' where bureau = 'special_investigations';

-- Prosecutor bureau assignments (all rows ended — historical): the old State
-- Bureau book of business moved to Street Crimes.
update public.prosecutor_bureau_assignments set bureau = 'street_crimes' where bureau = 'special_investigations';
update public.prosecutor_coverage set bureau = 'street_crimes' where bureau = 'special_investigations';
update public.justice_memberships set prosecutor_bureau = 'street_crimes' where prosecutor_bureau = 'special_investigations';
update public.member_transfers set target_bureau = 'street_crimes' where target_bureau = 'special_investigations';

-- Remaining bureau-typed columns must carry no stray ex-SAB value.
do $chk$ begin
  if exists (select 1 from public.case_templates where bureau = 'special_investigations')
     or exists (select 1 from public.documents where bureau = 'special_investigations')
     or exists (select 1 from public.shift_reports where bureau = 'special_investigations')
     or exists (select 1 from public.surveillance_targets where bureau = 'special_investigations')
     or exists (select 1 from public.tickets where routed_bureau = 'special_investigations')
     or exists (select 1 from public.trackers where bureau = 'special_investigations') then
    raise exception 'bureau restructure: stray special_investigations value in a secondary table';
  end if;
end $chk$;

-- ----------------------------------------------------------------------------
-- 4. Helper vocabulary: labels, prefixes, number bases.
-- ----------------------------------------------------------------------------
create or replace function private.bureau_label(p_bureau text)
returns text
language sql immutable
set search_path = ''
as $$
  select case lower(coalesce(p_bureau, ''))
           when 'major_crimes' then 'Major Crimes'
           when 'street_crimes' then 'Street Crimes'
           when 'special_investigations' then 'SIB'
           when 'jtf' then 'JTF'
           else coalesce(p_bureau, '')
         end
$$;

create or replace function private.bureau_prefix(p_bureau text)
returns text
language sql immutable
set search_path = ''
as $$
  select case lower(coalesce(p_bureau, ''))
           when 'major_crimes' then 'MCB'
           when 'street_crimes' then 'SCB'
           when 'special_investigations' then 'SIB'
           when 'jtf' then 'JTF'
           else upper(coalesce(p_bureau, ''))
         end
$$;

create or replace function private.case_number_base(p_bureau text)
returns bigint
language sql immutable
set search_path = ''
as $$
  select case lower(coalesce(p_bureau, ''))
           when 'major_crimes' then 4000000
           when 'street_crimes' then 5000000
           when 'jtf' then 3000000
           when 'special_investigations' then 8000000
           else 4000000
         end::bigint
$$;

-- New cases mint numbers in each bureau's fresh range (MCB-4######,
-- SCB-5######); preserved legacy numbers sit outside the window and never
-- collide.
create or replace function public.next_case_number(p_bureau text)
returns text
language sql stable security definer
set search_path = ''
as $$
  with base as (
    select private.case_number_base(p_bureau) as lo
  ),
  candidates as (
    select (regexp_replace(c.case_number, '^[A-Z]+-', ''))::bigint as n
    from public.cases c
    where c.bureau::text = p_bureau
      and c.case_number ~ '^[A-Z]+-[0-9]+$'
  )
  select private.bureau_prefix(p_bureau) || '-' || (
    coalesce(
      (select max(n) from candidates, base where n between base.lo and base.lo + 999999),
      (select lo from base)
    ) + 1
  )::text
$$;

-- The SIB number series continues the historical SIU-8###### sequence under
-- the SIB- prefix (legacy identifiers are preserved data, so the generator
-- must count them to stay collision-free and keep the series contiguous).
create or replace function public.next_siu_case_number()
returns text
language sql stable security definer
set search_path = ''
as $$
  select 'SIB-' || (
    coalesce(
      (select max((regexp_replace(c.case_number, '^SI[UB]-', ''))::bigint)
         from public.cases c
        where c.case_authority = 'siu' and c.case_number ~ '^SI[UB]-[0-9]+$'),
      8000000::bigint)
    + 1)::text
$$;

-- ----------------------------------------------------------------------------
-- 5. Guard: the normal case-creation path may not use special_investigations
--    (SIB cases are opened through siu_create_case, which runs as definer).
-- ----------------------------------------------------------------------------
create or replace function private.can_create_case(p_bureau public.bureau)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.is_active() and p_bureau <> 'special_investigations' and (
    p_bureau = 'JTF'
    or p_bureau = (select division from public.profiles where id = (select auth.uid()))
    or private.is_command()
  )
$$;

-- ----------------------------------------------------------------------------
-- 6. Rewrite every function that named the old bureaus.
-- ----------------------------------------------------------------------------

-- Audiences: announcements + reading campaigns speak the new bureau ids.
create or replace function private.announcement_recipients(p_audience text, p_mentions jsonb, p_author uuid)
returns table(user_id uuid, mentioned boolean)
language sql stable security definer
set search_path = ''
as $$
  with targets as (
    select m->>'target' as t from jsonb_array_elements(coalesce(p_mentions, '[]'::jsonb)) m
  ),
  aud as (
    select p.id from public.profiles p
    where p.active and p.removed_at is null
      and (not p.is_test or private.is_test_user(p_author))
      and (
      p_audience = 'all'
      or (p_audience = 'command' and (p.role in ('bureau_lead', 'deputy_director', 'director') or p.is_owner))
      or (p_audience in ('major_crimes', 'street_crimes', 'JTF') and p.division::text = p_audience)
    )
  ),
  ment as (
    select p.id from public.profiles p
    where p.active and p.removed_at is null
      and (not p.is_test or private.is_test_user(p_author))
      and exists (
      select 1 from targets t where
        (t.t = 'all' and private.can_post_audience('all'))
        or (t.t like 'role:%' and p.role::text = substring(t.t from 6))
        or t.t = p.id::text
    )
  )
  select ids.id as user_id, bool_or(ids.m) as mentioned
  from (
    select id, false as m from aud
    union all
    select id, true as m from ment
  ) ids
  where ids.id <> p_author
  group by ids.id
$$;

create or replace function private.can_post_audience(a text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.is_active() and (
    case
      when a = 'all' then
        coalesce((select role in ('deputy_director', 'director') or is_owner
                    from public.profiles where id = (select auth.uid())), false)
      when a in ('command', 'specific_members') then private.can_announce()
      when a in ('major_crimes', 'street_crimes', 'JTF') then
        coalesce((select (role in ('deputy_director', 'director') or is_owner)
                      or (role = 'bureau_lead' and division::text = a)
                    from public.profiles where id = (select auth.uid())), false)
      else false
    end)
$$;

create or replace function private.document_campaign_recipients(p_document uuid, p_audience text, p_targets jsonb, p_creator uuid)
returns table(user_id uuid)
language sql stable security definer
set search_path = ''
as $$
  select p.id from public.profiles p, public.documents d
  where d.id = p_document
    and p.active and p.removed_at is null and not p.is_system
    and p.is_test = private.is_test_user(p_creator)
    and p.id <> p_creator
    and (
      p_audience = 'all'
      or (p_audience in ('major_crimes', 'street_crimes', 'JTF') and p.division::text = p_audience)
      or (p_audience = 'command'
          and (p.role in ('bureau_lead', 'deputy_director', 'director') or p.is_owner))
      or (p_audience = 'detectives' and p.role = 'detective')
      or (p_audience = 'senior_detectives' and p.role = 'senior_detective')
      or (p_audience = 'specific'
          and coalesce(p_targets, '[]'::jsonb) @> to_jsonb(p.id::text))
    )
    and case coalesce(d.classification, 'internal')
      when 'internal' then true
      when 'restricted' then p.role in ('senior_detective', 'bureau_lead',
                                        'deputy_director', 'director') or p.is_owner
      when 'command' then p.role in ('bureau_lead', 'deputy_director', 'director') or p.is_owner
      when 'justice' then p.is_owner or exists (
        select 1 from public.justice_memberships m where m.user_id = p.id and m.active)
      when 'owner' then p.is_owner
      else false end
$$;

-- A JTF case born without an explicit origin inherits the creator's
-- permanent bureau.
create or replace function private.default_case_originating_bureau()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.originating_bureau = 'JTF' then new.originating_bureau := null; end if;
  if new.bureau = 'JTF' and new.originating_bureau is null then
    select p.division into new.originating_bureau
      from public.profiles p
     where p.id = coalesce(new.created_by, (select auth.uid()))
       and p.division in ('major_crimes', 'street_crimes');
  end if;
  return new;
end $$;

-- The new bureaus are functional, not geographic — every active CID member
-- sees the whole field-intel jurisdiction (SIB standing keeps its own gate).
create or replace function private.field_jurisdiction_visible_for(p_user uuid, p_jurisdiction text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select case
    when coalesce(private.siu_standing(p_user) in
           ('owner', 'special_agent_in_charge', 'senior_special_agent', 'special_agent'),
         false) then true
    else coalesce((select p.active from public.profiles p where p.id = p_user), false)
  end
$$;

create or replace function private.get_routing_ada_for_bureau(p_bureau public.bureau)
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select a.prosecutor_id
    from public.prosecutor_bureau_assignments a
    join public.justice_memberships m on m.user_id = a.prosecutor_id
   where a.bureau = p_bureau and a.ends_at is null and a.starts_at <= now()
     and p_bureau in ('major_crimes', 'street_crimes')
     and m.active
     and m.justice_role in ('assistant_district_attorney', 'district_attorney')
     and a.assignment_type in ('acting', 'primary')
   order by case a.assignment_type when 'acting' then 0 else 1 end
   limit 1
$$;

create or replace function private.legal_resolve_bureau(p_case uuid)
returns public.bureau
language plpgsql security definer
set search_path = ''
as $$
declare c public.cases; v public.bureau; v_src text; v_pfx text;
begin
  select * into c from public.cases where id = p_case;
  if not found then raise exception 'case not found'; end if;
  if c.bureau in ('major_crimes', 'street_crimes') then return c.bureau; end if;
  if c.originating_bureau in ('major_crimes', 'street_crimes') then return c.originating_bureau; end if;

  -- Derivation for JTF-assigned cases. Priority mirrors the recorded history:
  -- the case-number prefix is the bureau the number was minted under (numbers
  -- never change on reassignment), then the lead's bureau, then the creator's.
  -- Legacy prefixes map through the restructure (LSB→Major Crimes,
  -- BCB→Street Crimes); an ex-SAB prefix is ambiguous under the split and
  -- falls through to the lead/creator derivation.
  v_pfx := split_part(coalesce(c.case_number, ''), '-', 1);
  if v_pfx in ('MCB', 'LSB') then
    v := 'major_crimes'; v_src := 'case_number';
  elsif v_pfx in ('SCB', 'BCB') then
    v := 'street_crimes'; v_src := 'case_number';
  end if;
  if v is null then
    select p.division into v from public.profiles p
     where p.id = c.lead_detective_id and p.division in ('major_crimes', 'street_crimes');
    if v is not null then v_src := 'lead_detective'; end if;
  end if;
  if v is null then
    select p.division into v from public.profiles p
     where p.id = c.created_by and p.division in ('major_crimes', 'street_crimes');
    if v is not null then v_src := 'creator'; end if;
  end if;
  if v is null then
    raise exception 'this case needs a responsible bureau for legal routing — a CID supervisor must select Major Crimes or Street Crimes on the case';
  end if;

  -- Persist so the answer is stable and the user is never re-asked; audited
  -- like the manual set. Guarded on "still unset" so a concurrent manual set
  -- is never overwritten.
  update public.cases set originating_bureau = v
   where id = c.id and originating_bureau is null;
  if found then
    insert into public.audit_log (actor_id, action, entity, entity_id, detail)
    values ((select auth.uid()), 'ORIGINATING_BUREAU_SET', 'cases', c.id,
            jsonb_build_object('bureau', v, 'source', 'derived:' || v_src,
                               'via', 'legal_resolve_bureau'));
  end if;
  return v;
end $$;

create or replace function private.pba_validate(p_prosecutor uuid, p_bureau public.bureau, p_type text)
returns void
language plpgsql stable security definer
set search_path = ''
as $$
declare v_role text;
begin
  if p_bureau not in ('major_crimes', 'street_crimes') then
    raise exception 'a prosecutor bureau must be Major Crimes or Street Crimes';
  end if;
  select justice_role into v_role from public.justice_memberships
   where user_id = p_prosecutor and active;
  if v_role is null then raise exception 'target has no active justice membership'; end if;
  if v_role = 'judge' then raise exception 'a Judge may never receive a bureau assignment'; end if;
  if v_role = 'attorney_general' then raise exception 'the Attorney General oversees DOJ-wide and does not take bureau assignments'; end if;
  if v_role = 'district_attorney' and p_type <> 'acting' then
    raise exception 'a District Attorney may only serve as acting bureau prosecutor';
  end if;
  if v_role = 'assistant_district_attorney' and p_type not in ('primary', 'supporting', 'acting') then
    raise exception 'invalid assignment type';
  end if;
end $$;

create or replace function public.assign_member(target uuid, set_active boolean)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  me public.profiles;
  t public.profiles;
  r public.membership_requests;
begin
  select * into me from public.profiles where id = v_uid;
  if me.id is null or not (me.active and (me.role in ('bureau_lead','deputy_director','director') or me.is_owner)) then
    raise exception 'not authorized';
  end if;
  select * into t from public.profiles where id = target for update;
  if t.id is null then raise exception 'target not found'; end if;
  -- System accounts (the permanent-deletion tombstone) are data anchors,
  -- never members — same refusal the permanent_delete_* RPCs already make.
  if t.is_system then
    raise exception 'system accounts cannot be modified';
  end if;
  -- Bureau Lead restrictions (owner override bypasses these, as before).
  if me.role = 'bureau_lead' and not me.is_owner then
    if t.division is distinct from me.division then
      raise exception 'bureau leads may only manage members in their own bureau';
    end if;
    if t.role in ('bureau_lead','deputy_director','director') then
      raise exception 'bureau leads cannot manage command staff';
    end if;
  end if;
  if set_active and t.removed_at is not null then
    raise exception 'member was removed — restore them first';
  end if;
  if set_active and t.login_denied then
    raise exception 'member login is denied — restore login first';
  end if;
  if set_active and exists (
    select 1 from public.justice_memberships m where m.user_id = target and m.active
  ) then
    raise exception 'member holds an active DOJ/Judiciary membership — use organization correction (Move to CID) to bring them back, do not reactivate CID access';
  end if;
  -- A recorded queue decision cannot be silently contradicted: activating an
  -- applicant whose request was rejected or withdrawn must go back through
  -- the approval queue. Only the inactive→active transition is guarded —
  -- deactivation and already-active no-ops pass through untouched.
  if set_active and not t.active and exists (
    select 1 from public.membership_requests mr
    where mr.applicant_id = target and mr.status in ('rejected', 'withdrawn')
  ) then
    raise exception 'this applicant''s membership request was rejected — re-review it in the approval queue before activating';
  end if;
  if t.active = set_active then return; end if;

  update public.profiles set active = set_active where id = target;
  insert into public.role_events (target_id, actor_id, old_role, new_role,
    old_division, new_division, old_active, new_active, source)
  values (target, v_uid, t.role, t.role, t.division, t.division, t.active, set_active, 'activation');

  -- Reconciliation: a direct activation closes the applicant's open request
  -- so the approval queue never carries a ghost (pending row + active
  -- profile). Bookkeeping only — review_membership_request owns the
  -- applicant notification fan-out, so no notification is sent here.
  if set_active then
    select * into r from public.membership_requests
     where applicant_id = target and status in ('pending', 'correction_requested')
     for update;
    if found then
      update public.membership_requests
         set status = 'approved',
             decided_by = v_uid,
             decided_at = now(),
             decided_role = t.role,
             decided_bureau = case when t.division in ('major_crimes', 'street_crimes')
                                   then t.division else null end,
             internal_decision_note = case
               when internal_decision_note is null or btrim(internal_decision_note) = ''
                 then 'Auto-reconciled: member activated directly via assign_member.'
               else internal_decision_note || E'\n'
                 || 'Auto-reconciled: member activated directly via assign_member.'
             end
       where id = r.id;
      perform private.mr_history(r.id, 'approved', r.status, 'approved',
        'Auto-reconciled: member activated directly via assign_member.', true);
    end if;
  end if;
end $$;

create or replace function public.case_reassign_bureau(p_case uuid, p_to_bureau public.bureau, p_reason text, p_update_originating boolean default false)
returns public.cases
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  me public.profiles;
  c public.cases;
  v_from public.bureau;
  v_orig_from public.bureau;
  v_orig_to public.bureau;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_is_test boolean;
begin
  select * into me from public.profiles where id = v_uid;
  if me.id is null or not (coalesce(me.active, false)
       and (me.role in ('deputy_director', 'director') or coalesce(me.is_owner, false))) then
    raise exception 'only a Deputy Director or higher may reassign a case between bureaus';
  end if;
  if v_reason = '' then raise exception 'a reason is required'; end if;
  if p_to_bureau not in ('major_crimes', 'street_crimes') then
    raise exception 'cases may only be reassigned to Major Crimes or Street Crimes — JTF is a shared-visibility designation, and SIB takes control through its own assumption workflow';
  end if;

  select * into c from public.cases where id = p_case for update;
  if c.id is null then raise exception 'case not found'; end if;
  if c.bureau = p_to_bureau then
    raise exception 'case is already in % — reload and retry', private.bureau_label(p_to_bureau::text);
  end if;

  v_from := c.bureau;
  v_orig_from := c.originating_bureau;
  v_orig_to := case when p_update_originating then p_to_bureau else c.originating_bureau end;

  update public.cases
     set bureau = p_to_bureau, originating_bureau = v_orig_to
   where id = p_case returning * into c;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'REASSIGN_BUREAU', 'cases', p_case, jsonb_build_object(
    'case_number', c.case_number,
    'from', v_from, 'to', p_to_bureau,
    'originating_from', v_orig_from, 'originating_to', v_orig_to,
    'reason', left(v_reason, 500),
    'status', c.status, 'is_joint_case', c.is_joint_case));

  select u.email like 'rls-test-%@cidportal.test' into v_is_test
    from auth.users u where u.id = v_uid;
  insert into public.notifications (user_id, type, payload)
  select p.id, 'case_reassigned', jsonb_build_object(
    'case_id', p_case, 'case_number', c.case_number,
    'from', v_from, 'to', p_to_bureau,
    'reason', 'Case ' || coalesce(c.case_number, '') || ' was reassigned from '
      || private.bureau_label(v_from::text) || ' to ' || private.bureau_label(p_to_bureau::text)
      || '. Reason: ' || v_reason,
    'actor_id', v_uid, 'actor_name', me.display_name)
    from public.profiles p
   where p.active and p.removed_at is null and p.id <> v_uid
     and (p.id is not distinct from c.lead_detective_id
          or exists (select 1 from public.case_assignments a
                      where a.case_id = p_case and a.officer_id = p.id
                        and a.removed_at is null
                        and (a.expires_at is null or a.expires_at > now())))
     and (not coalesce(v_is_test, false)
          or exists (select 1 from auth.users u
                      where u.id = p.id and u.email like 'rls-test-%@cidportal.test'));

  return c;
end $$;

create or replace function public.change_member_role(p_target uuid, p_new_role public.app_role, p_reason text)
returns public.profiles
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  me public.profiles;
  t public.profiles;
  v_old_role public.app_role;
begin
  select * into me from public.profiles where id = v_uid;
  if me.id is null or not (me.active and (me.role in ('bureau_lead','deputy_director','director') or me.is_owner)) then
    raise exception 'not authorized to change roles';
  end if;
  if p_target = v_uid then raise exception 'you cannot change your own role'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'a reason is required'; end if;
  if p_new_role is null
     or p_new_role not in ('detective','senior_detective','bureau_lead','deputy_director','director') then
    raise exception 'invalid role';
  end if;

  select * into t from public.profiles where id = p_target for update;
  if t.id is null then raise exception 'member not found'; end if;
  if t.removed_at is not null then raise exception 'member has been removed'; end if;
  if not t.active then raise exception 'member is not active — reactivate or re-approve first'; end if;
  if t.login_denied then raise exception 'member login is denied'; end if;
  if t.role = p_new_role then raise exception 'member already holds this role'; end if;
  if t.division not in ('major_crimes','street_crimes') then
    raise exception 'member has no permanent department yet';
  end if;
  -- The owner super-grant outranks every CID rank; only another owner may
  -- touch an owner account's CID role.
  if t.is_owner and not me.is_owner then
    raise exception 'only the owner may change an owner account';
  end if;
  if not (private.can_assign_cid_role(t.role, t.division)
          and private.can_assign_cid_role(p_new_role, t.division)) then
    raise exception 'you are not authorized to change % to % in %', t.role, p_new_role, private.bureau_label(t.division::text);
  end if;

  v_old_role := t.role;
  update public.profiles set role = p_new_role where id = p_target returning * into t;
  insert into public.role_events (target_id, actor_id, old_role, new_role,
    old_division, new_division, old_active, new_active, reason, source)
  values (p_target, v_uid, v_old_role, p_new_role,
    t.division, t.division, t.active, t.active, p_reason, 'role_change');
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'ROLE_CHANGED', 'profiles', p_target,
    jsonb_build_object('new_role', p_new_role, 'reason', p_reason));
  insert into public.notifications (user_id, type, payload)
  values (p_target, 'membership_update', jsonb_build_object(
    'status', 'role_changed',
    'reason', 'Your role is now ' || initcap(replace(p_new_role::text, '_', ' ')) || '. Reason: ' || p_reason,
    'actor_id', v_uid, 'actor_name', me.display_name));
  return t;
end $$;

create or replace function public.convert_case_to_joint(p_case uuid, p_members jsonb, p_note text default null::text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); c public.cases; v_n int;
begin
  if not private.can_manage_joint(p_case) then raise exception 'not permitted to manage this case'; end if;
  select * into c from public.cases where id = p_case for update;
  if not found then raise exception 'case not found'; end if;
  if c.is_joint_case then raise exception 'case is already a joint case'; end if;
  update public.cases
     set is_joint_case = true,
         originating_bureau = coalesce(originating_bureau,
           case when bureau in ('major_crimes', 'street_crimes') then bureau end),
         joint_case_created_by = v_uid, joint_case_created_at = now(),
         joint_case_ended_by = null, joint_case_ended_at = null
   where id = p_case;
  v_n := private.joint_apply_members(p_case, p_members, v_uid);
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (v_uid, 'JOINT_CASE_CREATED', 'cases', p_case);
  return jsonb_build_object('case_id', p_case, 'members_added', v_n);
end $$;

create or replace function public.doj_bureau_coverage()
returns table(bureau public.bureau, primary_ada_id uuid, primary_ada_name text, acting_id uuid, acting_name text, acting_role text, supporting jsonb, covered boolean, primary_since timestamptz, acting_since timestamptz)
language sql stable security definer
set search_path = ''
as $$
  with b as (select unnest(array['major_crimes','street_crimes']::public.bureau[]) as bureau),
  live as (
    select a.*, p.display_name, private.justice_role_of(a.prosecutor_id) as jrole
      from public.prosecutor_bureau_assignments a
      join public.profiles p on p.id = a.prosecutor_id
     where a.ends_at is null and a.starts_at <= now()
       and private.is_justice_active(a.prosecutor_id))
  select b.bureau,
         pr.prosecutor_id, pr.display_name,
         ac.prosecutor_id, ac.display_name, ac.jrole,
         coalesce((select jsonb_agg(jsonb_build_object('id', s.prosecutor_id, 'name', s.display_name)
                                    order by s.display_name)
                     from live s where s.bureau = b.bureau and s.assignment_type = 'supporting'),
                  '[]'::jsonb),
         (private.get_routing_ada_for_bureau(b.bureau) is not null),
         pr.starts_at, ac.starts_at
    from b
    left join live pr on pr.bureau = b.bureau and pr.assignment_type = 'primary'
    left join live ac on ac.bureau = b.bureau and ac.assignment_type = 'acting'
   where private.justice_role() is not null or private.is_active()
      or coalesce((select is_owner from public.profiles where id = (select auth.uid())), false)
$$;

create or replace function public.field_submission_create_case(p_submission uuid, p_bureau text, p_title text, p_summary text default null::text, p_lead uuid default null::uuid)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v public.field_submissions;
  v_case uuid;
  v_no text;
begin
  if not private.is_active() then raise exception 'not authorized'; end if;

  select * into v from public.field_submissions where id = p_submission;
  if not found then raise exception 'no such record'; end if;
  if not private.field_submission_readable(p_submission) then
    raise exception 'that record is not in your jurisdiction';
  end if;
  if v.status = 'draft' then raise exception 'that record has not been sent yet'; end if;

  if coalesce(btrim(coalesce(p_title, '')), '') = '' then
    raise exception 'the case needs a title';
  end if;
  if p_bureau not in ('major_crimes', 'street_crimes', 'JTF') then
    raise exception 'unknown bureau';
  end if;

  v_no := public.next_case_number(p_bureau);
  if coalesce(v_no, '') = '' then raise exception 'could not allocate a case number'; end if;

  insert into public.cases (case_number, bureau, title, summary, lead_detective_id, created_by)
  values (v_no, p_bureau::public.bureau, btrim(p_title),
          nullif(btrim(coalesce(p_summary, '')), ''),
          coalesce(p_lead, v_actor), v_actor)
  returning id into v_case;

  insert into public.field_submission_cases
    (submission_id, case_id, relation, submission_no, linked_by)
  values (p_submission, v_case, 'originated', v.submission_no, v_actor);

  if private.field_submission_transition_ok(v.status, 'actionable') then
    update public.field_submissions
       set status = 'actionable', updated_at = now()
     where id = p_submission;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SUBMISSION_CASE_OPENED', 'field_submissions', p_submission,
          jsonb_build_object('submission_no', v.submission_no,
                             'case_id', v_case, 'case_number', v_no));
  return v_case;
end $$;

create or replace function public.resolve_case_originating_bureau(p_case uuid, p_bureau public.bureau, p_reason text default null::text)
returns public.cases
language plpgsql security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); c public.cases; me public.profiles;
        v_old public.bureau; v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into me from public.profiles where id = v_uid;
  if me.id is null or not coalesce(me.active, false)
     or not (me.role in ('senior_detective', 'bureau_lead', 'deputy_director', 'director')
             or coalesce(me.is_owner, false)) then
    raise exception 'only a CID supervisor may set the responsible bureau';
  end if;
  select * into c from public.cases where id = p_case for update;
  if not found or not private.can_access_case(p_case) then
    raise exception 'case not found or not accessible';
  end if;
  if p_bureau not in ('major_crimes', 'street_crimes') then
    raise exception 'the responsible bureau must be Major Crimes or Street Crimes';
  end if;
  if c.bureau in ('major_crimes', 'street_crimes') then
    raise exception 'this case''s responsible bureau is its own bureau (%) — use the reassign-bureau workflow to move it', private.bureau_label(c.bureau::text);
  end if;
  v_old := c.originating_bureau;
  if v_old in ('major_crimes', 'street_crimes') then
    if v_old = p_bureau then
      raise exception 'the responsible bureau is already %', private.bureau_label(p_bureau::text);
    end if;
    if not (me.role in ('deputy_director', 'director') or coalesce(me.is_owner, false)) then
      raise exception 'the responsible bureau is already set to % — only a Deputy Director or higher may change it', private.bureau_label(v_old::text);
    end if;
    if v_reason = '' then
      raise exception 'a reason is required to change the responsible bureau';
    end if;
  end if;
  update public.cases set originating_bureau = p_bureau where id = p_case returning * into c;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid,
          case when v_old in ('major_crimes', 'street_crimes')
               then 'ORIGINATING_BUREAU_CHANGED' else 'ORIGINATING_BUREAU_SET' end,
          'cases', p_case,
          jsonb_build_object('bureau', p_bureau, 'previous', v_old, 'source', 'manual',
                             'reason', nullif(left(v_reason, 500), '')));
  return c;
end $$;

create or replace function public.review_membership_request(p_request uuid, p_decision text, p_final_bureau public.bureau default null::public.bureau, p_final_role public.app_role default null::public.app_role, p_applicant_note text default null::text, p_internal_note text default null::text)
returns public.membership_requests
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.membership_requests;
  v_uid uuid := (select auth.uid());
  me public.profiles;
  target public.profiles;
  v_status text;
begin
  select * into me from public.profiles where id = v_uid;
  if me.id is null or not me.active or not (me.role in ('bureau_lead', 'deputy_director', 'director') or me.is_owner) then
    raise exception 'not authorized to review membership requests';
  end if;
  select * into r from public.membership_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  -- Terminal rows are re-reviewable: a recorded rejection/withdrawal can be
  -- superseded by a new decision (the history rows carry the real prior
  -- status, so the supersession is visible in membership_request_history).
  if r.status not in ('pending', 'rejected', 'withdrawn') then
    raise exception 'request is not awaiting review';
  end if;
  if r.applicant_id = v_uid then raise exception 'you cannot review your own request'; end if;
  if p_decision not in ('approve', 'approve_with_changes', 'request_correction', 'reject') then
    raise exception 'invalid decision';
  end if;

  if p_decision = 'request_correction' then
    update public.membership_requests
       set status = 'correction_requested',
           applicant_visible_decision_note = p_applicant_note,
           internal_decision_note = coalesce(p_internal_note, internal_decision_note)
     where id = p_request returning * into r;
    perform private.mr_history(p_request, 'correction_requested', r.status, 'correction_requested', p_applicant_note, false);
    if p_internal_note is not null then
      perform private.mr_history(p_request, 'internal_note', null, null, p_internal_note, true);
    end if;
    insert into public.audit_log (actor_id, action, entity, entity_id)
    values (v_uid, 'CORRECTION_REQUESTED', 'membership_requests', p_request);
    insert into public.notifications (user_id, type, payload)
    values (r.applicant_id, 'membership_update', jsonb_build_object(
      'request_id', p_request, 'status', 'correction_requested',
      'reason', 'Your membership request needs a correction.',
      'actor_id', v_uid, 'actor_name', me.display_name));
    return r;
  end if;

  if p_decision = 'reject' then
    update public.membership_requests
       set status = 'rejected', decided_by = v_uid, decided_at = now(),
           applicant_visible_decision_note = p_applicant_note,
           internal_decision_note = coalesce(p_internal_note, internal_decision_note)
     where id = p_request returning * into r;
    perform private.mr_history(p_request, 'rejected', r.status, 'rejected', p_applicant_note, false);
    if p_internal_note is not null then
      perform private.mr_history(p_request, 'internal_note', null, null, p_internal_note, true);
    end if;
    insert into public.audit_log (actor_id, action, entity, entity_id)
    values (v_uid, 'REJECTED', 'membership_requests', p_request);
    insert into public.notifications (user_id, type, payload)
    values (r.applicant_id, 'membership_update', jsonb_build_object(
      'request_id', p_request, 'status', 'rejected',
      'reason', 'Your membership request was rejected.',
      'actor_id', v_uid, 'actor_name', me.display_name));
    return r;  -- profile stays inactive
  end if;

  -- approve / approve_with_changes
  if p_final_bureau is null or p_final_role is null then
    raise exception 'a final department and role are required to approve';
  end if;
  if p_final_bureau not in ('major_crimes', 'street_crimes') then
    raise exception 'members join Major Crimes or Street Crimes — JTF is a temporary joint-case designation and SIB membership is appointed through its own process';
  end if;
  if p_final_role not in ('detective', 'senior_detective', 'bureau_lead', 'deputy_director', 'director') then
    raise exception 'invalid role';
  end if;
  -- The unified authority matrix decides who may grant the FINAL role in the
  -- FINAL bureau.
  if not private.can_assign_cid_role(p_final_role, p_final_bureau) then
    raise exception 'you are not authorized to assign % in %', p_final_role, private.bureau_label(p_final_bureau::text);
  end if;
  select * into target from public.profiles where id = r.applicant_id for update;
  if target.id is null or target.removed_at is not null then raise exception 'applicant profile unavailable'; end if;
  if target.login_denied then raise exception 'applicant login is denied — restore login before approving'; end if;

  v_status := case when p_decision = 'approve'
                    and p_final_bureau = r.requested_bureau
                    and p_final_role = r.requested_role
              then 'approved' else 'approved_with_changes' end;
  -- Every adjustment away from what was requested needs a recorded reason the
  -- applicant can see.
  if v_status = 'approved_with_changes' and btrim(coalesce(p_applicant_note, '')) = '' then
    raise exception 'approving with changes requires a reason for the applicant';
  end if;
  update public.membership_requests
     set status = v_status, decided_by = v_uid, decided_at = now(),
         decided_bureau = p_final_bureau, decided_role = p_final_role,
         applicant_visible_decision_note = p_applicant_note,
         internal_decision_note = coalesce(p_internal_note, internal_decision_note)
   where id = p_request returning * into r;

  update public.profiles
     set role = p_final_role, division = p_final_bureau, active = true
   where id = r.applicant_id;
  insert into public.role_events (target_id, actor_id, old_role, new_role,
    old_division, new_division, old_active, new_active, reason, source, source_id)
  values (r.applicant_id, v_uid, target.role, p_final_role,
    target.division, p_final_bureau, target.active, true,
    p_applicant_note, 'membership_approval', p_request);

  perform private.mr_history(p_request, v_status, r.status, v_status, p_applicant_note, false);
  if p_internal_note is not null then
    perform private.mr_history(p_request, 'internal_note', null, null, p_internal_note, true);
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (v_uid, upper(v_status), 'membership_requests', p_request);
  insert into public.notifications (user_id, type, payload)
  values (r.applicant_id, 'member_approved', jsonb_build_object(
    'request_id', p_request, 'status', v_status,
    'reason', case when v_status = 'approved' then 'Your membership request was approved.'
                   else 'Your membership request was approved with changes.' end,
    'actor_id', v_uid, 'actor_name', me.display_name));
  return r;
end $$;

create or replace function public.correct_membership_organization(p_target uuid, p_direction text, p_reason text, p_requested_justice_role text default null::text, p_requested_bureau public.bureau default null::public.bureau, p_requested_role public.app_role default null::public.app_role)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  me public.profiles;
  t public.profiles;
  v_role text;
  v_agency text;
  v_req uuid;
  v_existing record;
  n_lead int; n_assign int; n_tasks int; n_transfers int; n_legal int; n_cov int;
begin
  select * into me from public.profiles where id = v_uid;
  if not private.is_owner() then
    raise exception 'organization correction is restricted to the owner';
  end if;
  if p_target = v_uid then raise exception 'you cannot correct your own membership'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'a reason is required'; end if;
  if p_direction not in ('cid_to_doj', 'cid_to_judiciary', 'justice_to_cid') then
    raise exception 'invalid direction';
  end if;

  select * into t from public.profiles where id = p_target for update;
  if t.id is null then raise exception 'member not found'; end if;
  if t.removed_at is not null then raise exception 'member has been removed — restore them first'; end if;
  if t.login_denied then raise exception 'member login is denied — restore login first'; end if;
  if t.is_test then raise exception 'test fixtures cannot be moved between organizations'; end if;

  if p_direction in ('cid_to_doj', 'cid_to_judiciary') then
    v_agency := case when p_direction = 'cid_to_doj' then 'doj' else 'judiciary' end;
    v_role := case when p_direction = 'cid_to_judiciary' then 'judge' else p_requested_justice_role end;
    if v_role is null
       or (v_agency = 'doj' and v_role not in ('assistant_district_attorney', 'district_attorney', 'attorney_general'))
       or (v_agency = 'judiciary' and v_role <> 'judge') then
      raise exception 'invalid justice role for %', v_agency;
    end if;
    if not t.active then raise exception 'target is not an active CID member'; end if;
    if exists (select 1 from public.justice_memberships m where m.user_id = p_target and m.active) then
      raise exception 'member already holds an active justice membership';
    end if;

    select count(*) into n_lead from public.cases c
     where c.lead_detective_id = p_target and c.status <> 'closed';
    select count(*) into n_assign from public.case_assignments a
     where a.officer_id = p_target and (a.expires_at is null or a.expires_at > now());
    select count(*) into n_tasks from public.case_tasks k
     where k.assignee = p_target and not k.done;
    select count(*) into n_transfers from public.transfer_requests r
     where r.target_id = p_target and r.status in ('pending_source', 'pending_target', 'approved');
    if n_lead + n_assign + n_tasks + n_transfers > 0 then
      raise exception 'unresolved active assignments block this correction (% lead cases, % case assignments, % open tasks, % open transfers) — reassign them first',
        n_lead, n_assign, n_tasks, n_transfers;
    end if;

    update public.profiles set active = false where id = p_target;
    insert into public.role_events (target_id, actor_id, old_role, new_role,
      old_division, new_division, old_active, new_active, reason, source)
    values (p_target, v_uid, t.role, t.role, t.division, t.division, true, false,
      p_reason, 'activation');

    select id, status into v_existing from public.justice_membership_requests
     where applicant_id = p_target for update;
    if v_existing.id is not null and v_existing.status in ('draft', 'pending', 'correction_requested') then
      raise exception 'member already has an open justice membership request';
    end if;
    if v_existing.id is not null then
      update public.justice_membership_requests
         set requested_agency = v_agency, requested_justice_role = v_role,
             display_name = coalesce(t.display_name, 'Officer'),
             reason = p_reason, additional_notes = 'Organization correction initiated by the owner.',
             status = 'pending', submitted_at = now(),
             decided_agency = null, decided_justice_role = null,
             applicant_visible_decision_note = null, decided_by = null, decided_at = null
       where id = v_existing.id returning id into v_req;
      perform private.jmr_history(v_req, 'submitted', v_existing.status, 'pending',
        'Organization correction: ' || p_reason, false);
    else
      insert into public.justice_membership_requests
        (applicant_id, display_name, requested_agency, requested_justice_role,
         reason, additional_notes, status, submitted_at)
      values (p_target, coalesce(t.display_name, 'Officer'), v_agency, v_role,
        p_reason, 'Organization correction initiated by the owner.', 'pending', now())
      returning id into v_req;
      perform private.jmr_history(v_req, 'submitted', 'draft', 'pending',
        'Organization correction: ' || p_reason, false);
    end if;

  else  -- justice_to_cid
    if p_requested_bureau is null or p_requested_bureau not in ('major_crimes', 'street_crimes') then
      raise exception 'a permanent CID department (Major Crimes or Street Crimes) is required';
    end if;
    if p_requested_role is null
       or p_requested_role not in ('detective','senior_detective','bureau_lead','deputy_director','director') then
      raise exception 'invalid CID role';
    end if;
    if not exists (select 1 from public.justice_memberships m where m.user_id = p_target and m.active) then
      raise exception 'target has no active justice membership';
    end if;

    select count(*) into n_legal from public.legal_requests l
     where (l.assigned_ada_id = p_target or l.assigned_judge_id = p_target)
       and l.review_status not in ('denied', 'withdrawn', 'closed');
    select count(*) into n_cov from public.prosecutor_bureau_assignments a
     where a.prosecutor_id = p_target and (a.ends_at is null or a.ends_at > now());
    if n_legal + n_cov > 0 then
      raise exception 'unresolved justice work blocks this correction (% assigned legal requests, % bureau coverage assignments) — reassign them first',
        n_legal, n_cov;
    end if;

    update public.justice_memberships set active = false where user_id = p_target;

    select id, status into v_existing from public.membership_requests
     where applicant_id = p_target for update;
    if v_existing.id is not null and v_existing.status in ('draft', 'pending', 'correction_requested') then
      raise exception 'member already has an open CID membership request';
    end if;
    if v_existing.id is not null then
      update public.membership_requests
         set requested_bureau = p_requested_bureau, requested_role = p_requested_role,
             display_name = coalesce(t.display_name, 'Officer'),
             reason = p_reason, additional_notes = 'Organization correction initiated by the owner.',
             status = 'pending', submitted_at = now(),
             decided_bureau = null, decided_role = null,
             applicant_visible_decision_note = null, decided_by = null, decided_at = null
       where id = v_existing.id returning id into v_req;
      perform private.mr_history(v_req, 'submitted', v_existing.status, 'pending',
        'Organization correction: ' || p_reason, false);
    else
      insert into public.membership_requests
        (applicant_id, display_name, requested_bureau, requested_role,
         reason, additional_notes, status, submitted_at)
      values (p_target, coalesce(t.display_name, 'Officer'), p_requested_bureau, p_requested_role,
        p_reason, 'Organization correction initiated by the owner.', 'pending', now())
      returning id into v_req;
      perform private.mr_history(v_req, 'submitted', 'draft', 'pending',
        'Organization correction: ' || p_reason, false);
    end if;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'ORG_CORRECTION_INITIATED', 'profiles', p_target,
    jsonb_build_object('direction', p_direction, 'reason', p_reason,
      'request_id', v_req,
      'requested_justice_role', case when p_direction <> 'justice_to_cid' then v_role end,
      'requested_bureau', case when p_direction = 'justice_to_cid' then p_requested_bureau::text end,
      'requested_role', case when p_direction = 'justice_to_cid' then p_requested_role::text end));
  insert into public.notifications (user_id, type, payload)
  values (p_target, 'membership_update', jsonb_build_object(
    'status', 'org_correction', 'request_id', v_req,
    'reason', case when p_direction = 'justice_to_cid'
      then 'Your account is being moved to CID — a membership request is awaiting Command approval. Reason: ' || p_reason
      else 'Your account is being moved to ' || case when p_direction = 'cid_to_doj' then 'the DOJ' else 'the Judiciary' end
        || ' — a membership request is awaiting approval. Reason: ' || p_reason end,
    'actor_id', v_uid, 'actor_name', me.display_name));

  return jsonb_build_object('request_id', v_req, 'direction', p_direction);
end $$;

create or replace function public.justice_set_coverage(p_user uuid, p_bureau public.bureau, p_reason text, p_expires_at timestamptz default null::timestamptz)
returns public.prosecutor_coverage
language plpgsql security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); c public.prosecutor_coverage;
begin
  if not (coalesce(private.justice_role_effective(v_uid) = 'attorney_general', false)
          or private.owner_flag(v_uid)) then
    raise exception 'only the Attorney General or Owner may manage coverage';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'a reason is required'; end if;
  if p_bureau not in ('major_crimes', 'street_crimes') then
    raise exception 'coverage bureau must be Major Crimes or Street Crimes';
  end if;
  if coalesce(private.justice_role_effective(p_user) = 'prosecutor', false) is not true then
    raise exception 'coverage can only be granted to an active Prosecutor';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'the expiry must be in the future';
  end if;
  insert into public.prosecutor_coverage (prosecutor_id, bureau, reason, authorized_by, expires_at)
  values (p_user, p_bureau, btrim(p_reason), v_uid, p_expires_at)
  returning * into c;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'PROSECUTOR_COVERAGE_GRANTED', 'prosecutor_coverage', c.id,
          jsonb_build_object('prosecutor', p_user, 'bureau', p_bureau,
                             'expires_at', p_expires_at, 'reason', left(p_reason, 300)));
  insert into public.notifications (user_id, type, payload)
  values (p_user, 'justice_membership_update', jsonb_build_object(
    'reason', 'You were granted temporary prosecutor coverage for ' || private.bureau_label(p_bureau::text)
      || coalesce(' until ' || to_char(p_expires_at, 'YYYY-MM-DD HH24:MI'), '') || '.'));
  return c;
end $$;

create or replace function public.justice_appoint(p_user uuid, p_role text, p_reason text default null::text, p_bureau public.bureau default null::public.bureau)
returns public.justice_memberships
language plpgsql security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); m public.justice_memberships;
        me public.profiles; t public.profiles; v_cid_authority boolean;
        v_ag boolean; v_tr uuid; v_led int := 0; v_is_test boolean; rec record;
begin
  if p_role not in ('prosecutor', 'judge', 'attorney_general') then
    raise exception 'role must be prosecutor, judge, or attorney_general';
  end if;
  if p_role = 'prosecutor' and (p_bureau is null or p_bureau not in ('major_crimes', 'street_crimes')) then
    raise exception 'a prosecutor needs a home bureau: Major Crimes or Street Crimes';
  end if;
  if p_role <> 'prosecutor' and p_bureau is not null then
    raise exception 'only prosecutors carry a home bureau';
  end if;
  select * into me from public.profiles where id = v_uid;
  v_ag := coalesce(private.justice_role_effective(v_uid) = 'attorney_general', false);
  v_cid_authority := coalesce(me.is_owner, false)
    or (coalesce(me.active, false) and me.role in ('deputy_director', 'director'));
  if p_role = 'attorney_general' then
    if not coalesce(me.is_owner, false) then
      raise exception 'only the Owner may appoint an Attorney General';
    end if;
  elsif not (v_ag or v_cid_authority) then
    raise exception 'only the Attorney General, Deputy Director+, or Owner may appoint DOJ members';
  end if;
  if p_user = v_uid and not coalesce(me.is_owner, false) then
    raise exception 'you cannot appoint yourself';
  end if;
  select * into t from public.profiles where id = p_user;
  if t.id is null or t.removed_at is not null or coalesce(t.login_denied, false)
     or coalesce(t.is_test, false) or coalesce(t.is_system, false) then
    raise exception 'target account is not eligible for a DOJ appointment';
  end if;

  if coalesce(t.active, false) then
    if not v_cid_authority then
      raise exception 'moving an active CID member into the DOJ requires Deputy Director+ or Owner';
    end if;
    select count(*) into v_led from public.cases c
     where c.lead_detective_id = p_user and c.status <> 'closed' and c.archived_at is null;
    insert into public.member_transfers
      (user_id, direction, status, requested_role, target_bureau, from_role, from_division,
       reason, requested_by, cid_decided_by, cid_decided_at,
       doj_decided_by, doj_decided_at, effective_by, effective_at,
       handover)
    values (p_user, 'cid_to_doj', 'effective', p_role, p_bureau, t.role::text, t.division::text,
            coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Direct DOJ assignment'),
            v_uid, v_uid, now(), v_uid, now(), v_uid, now(),
            jsonb_build_object('direct', true, 'led_cases_open', v_led,
                               'led_cases_interim_lead', case when v_led > 0 then v_uid end))
    returning id into v_tr;
    update public.profiles set active = false where id = p_user;
    insert into public.role_events
      (target_id, actor_id, old_role, new_role, old_division, new_division,
       old_active, new_active, reason, source, source_id)
    values (p_user, v_uid, t.role, t.role, t.division, t.division,
            true, false, 'Assigned to DOJ: ' || p_role, 'doj_transfer', v_tr);
    update public.case_assignments
       set removed_at = now(), removed_by = v_uid, removal_reason = 'Assigned to DOJ'
     where officer_id = p_user and removed_at is null;
    -- Handover: led cases move to the acting authority as INTERIM lead
    -- (reassigned, never stranded); each is audited and command is notified.
    if v_led > 0 then
      select u.email like 'rls-test-%@cidportal.test' into v_is_test
        from auth.users u where u.id = v_uid;
      for rec in select c.id, c.case_number from public.cases c
                  where c.lead_detective_id = p_user and c.status <> 'closed' and c.archived_at is null
      loop
        update public.cases set lead_detective_id = v_uid where id = rec.id;
        insert into public.audit_log (actor_id, action, entity, entity_id, detail)
        values (v_uid, 'CASE_LEAD_INTERIM', 'cases', rec.id,
                jsonb_build_object('from', p_user, 'to', v_uid, 'transfer', v_tr,
                                   'reason', 'Previous lead assigned to DOJ'));
      end loop;
      insert into public.notifications (user_id, type, payload)
      select p.id, 'membership_update', jsonb_build_object(
        'reason', coalesce(t.display_name, 'A member') || ' was assigned to the DOJ — '
          || v_led || ' open case(s) they led were handed to '
          || coalesce(me.display_name, 'the assigning authority') || ' as interim lead.')
        from public.profiles p
       where p.active and p.removed_at is null and p.id <> v_uid
         and p.role in ('deputy_director', 'director')
         and (not coalesce(v_is_test, false)
              or exists (select 1 from auth.users u
                          where u.id = p.id and u.email like 'rls-test-%@cidportal.test'));
    end if;
  end if;

  insert into public.justice_memberships
    (user_id, agency, justice_role, active, approved_by, approved_at,
     ended_at, expires_at, prosecutor_bureau)
  values (p_user, case when p_role = 'judge' then 'judiciary' else 'doj' end,
          p_role, true, v_uid, now(), null, null,
          case when p_role = 'prosecutor' then p_bureau end)
  on conflict (user_id) do update
    set agency = excluded.agency, justice_role = excluded.justice_role,
        active = true, approved_by = excluded.approved_by, approved_at = excluded.approved_at,
        ended_at = null, expires_at = null,
        prosecutor_bureau = excluded.prosecutor_bureau;
  select * into m from public.justice_memberships where user_id = p_user;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'JUSTICE_APPOINTED', 'justice_memberships', p_user,
          jsonb_build_object('role', p_role, 'bureau', p_bureau,
                             'direct', coalesce(t.active, false),
                             'transfer', v_tr, 'led_cases_open', v_led,
                             'reason', left(coalesce(p_reason, ''), 300)));
  insert into public.notifications (user_id, type, payload)
  values (p_user, 'justice_membership_update', jsonb_build_object(
    'reason', 'You were appointed ' || replace(p_role, '_', ' ')
      || coalesce(' (' || private.bureau_label(p_bureau::text) || ' queue)', '')
      || case when coalesce(t.active, false)
              then ' — your CID membership has ended and your DOJ access is active now.'
              else ' in the DOJ legal-review workspace.' end));
  return m;
end $$;

create or replace function public.transfer_doj_request(p_user uuid, p_direction text, p_role text, p_reason text, p_bureau public.bureau default null::public.bureau)
returns public.member_transfers
language plpgsql security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); t public.profiles; tr public.member_transfers;
        v_jrole text;
begin
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'a reason is required'; end if;
  if p_user = v_uid then raise exception 'you cannot propose your own transfer'; end if;
  select * into t from public.profiles where id = p_user;
  if t.id is null or t.removed_at is not null or coalesce(t.is_system, false) or coalesce(t.is_test, false) then
    raise exception 'target account is not eligible for a transfer';
  end if;
  v_jrole := (select justice_role from public.justice_memberships
               where user_id = p_user and active);
  if p_direction = 'cid_to_doj' then
    if not (private.is_command() or private.owner_flag(v_uid)) then
      raise exception 'only CID Command may propose a CID-to-DOJ transfer';
    end if;
    if not coalesce(t.active, false) then
      raise exception 'target is not an active CID member';
    end if;
    if p_role = 'prosecutor' and (p_bureau is null or p_bureau not in ('major_crimes', 'street_crimes')) then
      raise exception 'a prosecutor transfer needs a home bureau: Major Crimes or Street Crimes';
    end if;
  elsif p_direction = 'doj_to_cid' then
    if not (coalesce(private.justice_role_effective(v_uid) = 'attorney_general', false)
            or private.owner_flag(v_uid)) then
      raise exception 'only the Attorney General or Owner may propose a DOJ-to-CID transfer';
    end if;
    if v_jrole is null then raise exception 'target holds no active DOJ membership'; end if;
  else
    raise exception 'invalid direction';
  end if;
  insert into public.member_transfers
    (user_id, direction, requested_role, target_bureau, from_role, from_division,
     from_justice_role, reason, requested_by)
  values (p_user, p_direction, p_role, p_bureau, t.role::text, t.division::text,
          v_jrole, btrim(p_reason), v_uid)
  returning * into tr;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'TRANSFER_DOJ_REQUESTED', 'member_transfers', tr.id,
          jsonb_build_object('member', p_user, 'direction', p_direction,
                             'role', p_role, 'bureau', p_bureau, 'reason', left(p_reason, 300)));
  insert into public.notifications (user_id, type, payload)
  values (p_user, 'membership_update', jsonb_build_object(
    'reason', 'An organizational transfer was proposed for you ('
      || replace(p_direction, '_', '-') || ', ' || replace(p_role, '_', ' ') || ').'));
  return tr;
end $$;

create or replace function public.transfer_doj_activate(p_transfer uuid, p_reassignments jsonb default '{}'::jsonb)
returns public.member_transfers
language plpgsql security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); tr public.member_transfers; me public.profiles;
        t public.profiles; rec record; v_new uuid; v_n int := 0; v_handover jsonb;
begin
  select * into me from public.profiles where id = v_uid;
  select * into tr from public.member_transfers where id = p_transfer for update;
  if not found then raise exception 'transfer not found'; end if;
  if tr.status <> 'doj_accepted' then raise exception 'transfer is not ready for activation'; end if;
  if tr.user_id = v_uid then raise exception 'you cannot activate your own transfer'; end if;
  if not (coalesce(me.active, false) and me.role in ('deputy_director', 'director')
          or coalesce(me.is_owner, false)
          or coalesce(private.justice_role_effective(v_uid) = 'attorney_general', false)) then
    raise exception 'only Deputy Director+, the Attorney General, or the Owner may activate a transfer';
  end if;
  select * into t from public.profiles where id = tr.user_id for update;

  v_handover := public.transfer_handover(p_transfer);

  if tr.direction = 'cid_to_doj' then
    -- A prosecutor must land in exactly one home bureau; older pending rows
    -- created before bureau queues carry none — refuse rather than guess.
    if tr.requested_role = 'prosecutor'
       and (tr.target_bureau is null or tr.target_bureau not in ('major_crimes', 'street_crimes')) then
      raise exception 'this prosecutor transfer has no home bureau — file a new transfer naming Major Crimes or Street Crimes';
    end if;
    -- Every open led case must have a resolution: a named new lead, or an
    -- approved dual-membership retention.
    for rec in select c.id, c.case_number from public.cases c
                where c.lead_detective_id = tr.user_id and c.status <> 'closed' and c.archived_at is null
    loop
      v_new := nullif(p_reassignments->'cases'->>rec.id::text, '')::uuid;
      if v_new is null and tr.retain_cid
         and (p_reassignments->'retain_case_ids') ? rec.id::text then
        continue;  -- explicitly retained under approved dual membership
      end if;
      if v_new is null then
        raise exception 'case % still needs a new lead detective before activation', rec.case_number;
      end if;
      if not exists (select 1 from public.profiles p
                      where p.id = v_new and p.active and p.removed_at is null and p.id <> tr.user_id) then
        raise exception 'proposed lead for case % is not an active member', rec.case_number;
      end if;
      update public.cases set lead_detective_id = v_new where id = rec.id;
      insert into public.notifications (user_id, type, payload)
      values (v_new, 'case_assigned', jsonb_build_object(
        'case_id', rec.id, 'case_number', rec.case_number,
        'reason', 'Case ' || rec.case_number || ' was handed to you during an organizational transfer.'));
      v_n := v_n + 1;
    end loop;
    -- Pending sign-offs routed to this member move to the named substitute.
    v_new := nullif(p_reassignments->>'signoffs_to', '')::uuid;
    if v_new is not null then
      update public.cases set signoff_assignee_id = v_new
       where signoff_assignee_id = tr.user_id and signoff_status like 'awaiting_%';
    elsif exists (select 1 from public.cases c
                   where c.signoff_assignee_id = tr.user_id and c.signoff_status like 'awaiting_%')
          and not tr.retain_cid then
      raise exception 'pending sign-offs still route to this member — name a substitute (signoffs_to)';
    end if;

    if not tr.retain_cid then
      -- End the CID membership (dated event, identity preserved).
      update public.profiles set active = false where id = tr.user_id;
      insert into public.role_events
        (target_id, actor_id, old_role, new_role, old_division, new_division,
         old_active, new_active, reason, source, source_id)
      values (tr.user_id, v_uid, t.role, t.role, t.division, t.division,
              true, false, 'Transferred to DOJ: ' || tr.requested_role, 'doj_transfer', tr.id);
      -- End active operational assignments (history rows preserved).
      update public.case_assignments
         set removed_at = now(), removed_by = v_uid,
             removal_reason = 'Transferred to DOJ'
       where officer_id = tr.user_id and removed_at is null;
    end if;

    -- Activate the DOJ membership through the transfer (never a fresh
    -- account); a prosecutor's home bureau rides in on target_bureau.
    perform private.transfer_doj_set_membership(
      tr.user_id, tr.requested_role, v_uid,
      case when tr.retain_cid then tr.dual_expires_at else null end,
      tr.target_bureau);
  else
    -- DOJ → CID. Unfinished DOJ work is requeued first (never stranded).
    for rec in select id from public.legal_requests
                where assigned_prosecutor_id = tr.user_id and review_status = 'prosecutor_review'
    loop
      perform private.legal_end_participant(rec.id, tr.user_id, 'prosecutor');
      update public.legal_requests
         set review_status = 'prosecutor_queue', assigned_prosecutor_id = null,
             prosecutor_claimed_at = null, queue_entered_at = now()
       where id = rec.id;
      perform private.legal_log(rec.id, null, 'prosecutor_unassigned',
        'prosecutor_review', 'prosecutor_queue', 'Holder transferred to CID.', null);
    end loop;
    for rec in select id from public.legal_requests
                where assigned_judge_id = tr.user_id and review_status = 'judicial_review'
    loop
      perform private.legal_end_participant(rec.id, tr.user_id, 'judicial_reviewer');
      update public.legal_requests
         set review_status = 'submitted_to_judge', assigned_judge_id = null
       where id = rec.id;
      perform private.legal_log(rec.id, null, 'judge_unassigned',
        'judicial_review', 'submitted_to_judge', 'Holder transferred to CID.', null);
    end loop;
    -- End the DOJ membership (dated; decisions + attribution stay).
    update public.justice_memberships
       set active = false, ended_at = now()
     where user_id = tr.user_id;
    -- Re-enter CID at the explicitly approved NEW bureau and rank.
    update public.profiles
       set active = true, role = tr.requested_role::public.app_role,
           division = tr.target_bureau
     where id = tr.user_id;
    insert into public.role_events
      (target_id, actor_id, old_role, new_role, old_division, new_division,
       old_active, new_active, reason, source, source_id)
    values (tr.user_id, v_uid, t.role, tr.requested_role::public.app_role,
            t.division, tr.target_bureau,
            coalesce(t.active, false), true,
            'Returned from DOJ as ' || tr.requested_role, 'doj_transfer', tr.id);
  end if;

  update public.member_transfers
     set status = 'effective', effective_by = v_uid, effective_at = now(),
         handover = v_handover, updated_at = now()
   where id = p_transfer returning * into tr;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'TRANSFER_DOJ_EFFECTIVE', 'member_transfers', p_transfer,
          jsonb_build_object('member', tr.user_id, 'direction', tr.direction,
                             'role', tr.requested_role, 'cases_reassigned', v_n,
                             'retain_cid', tr.retain_cid,
                             'same_actor_stages', tr.cid_decided_by = tr.doj_decided_by));
  insert into public.notifications (user_id, type, payload)
  values (tr.user_id, 'membership_update', jsonb_build_object(
    'reason', 'Your organizational transfer is now effective ('
      || replace(tr.requested_role, '_', ' ') || ').'));
  -- CID Command + AG visibility of the completed move.
  insert into public.notifications (user_id, type, payload)
  select p.id, 'membership_update', jsonb_build_object(
    'reason', coalesce((select display_name from public.profiles where id = tr.user_id), 'A member')
      || ' transferred ' || replace(tr.direction, '_', '-') || ' (' || tr.requested_role || ').')
    from public.profiles p
   where p.active and p.removed_at is null and p.id <> v_uid and p.id <> tr.user_id
     and (p.role in ('deputy_director', 'director')
          or coalesce(private.justice_role_effective(p.id) = 'attorney_general', false))
     and not coalesce(p.is_test, false);
  return tr;
end $$;

create or replace function public.owner_security_overview()
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_runs jsonb;
  v_fixtures jsonb;
  v_leftovers jsonb;
  test_ids uuid[];
begin
  if not private.is_owner() then raise exception 'not authorized'; end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb) into v_runs
    from (select id, suite, passed, failed, skipped, total, failures, commit_sha,
                 branch, release, source, duration_ms, created_at
            from public.security_test_runs
           order by created_at desc limit 20) r;

  -- Expected fixture roster (kept in sync with tests/rls/README.md).
  with expected(email, kind, exp_role, exp_division, exp_cid_active, exp_justice_role, exp_justice_active) as (values
    ('rls-test-lsb@cidportal.test', 'cid', 'detective', 'major_crimes', true, null, null),
    ('rls-test-bcb@cidportal.test', 'cid', 'detective', 'street_crimes', true, null, null),
    ('rls-test-inactive@cidportal.test', 'cid', null, null, false, null, null),
    ('rls-test-owner@cidportal.test', 'cid', 'detective', 'major_crimes', true, null, null),
    ('rls-test-lead@cidportal.test', 'cid', 'bureau_lead', 'major_crimes', true, null, null),
    ('rls-test-director@cidportal.test', 'cid', 'director', 'major_crimes', true, null, null),
    ('rls-test-target@cidportal.test', 'cid', 'detective', 'major_crimes', true, null, null),
    ('rls-test-applicant@cidportal.test', 'cid', null, null, false, null, null),
    ('rls-test-ada-lsb@cidportal.test', 'justice', null, null, false, 'assistant_district_attorney', true),
    ('rls-test-ada-bcb@cidportal.test', 'justice', null, null, false, 'assistant_district_attorney', true),
    ('rls-test-ada-sab@cidportal.test', 'justice', null, null, false, 'assistant_district_attorney', true),
    ('rls-test-da@cidportal.test', 'justice', null, null, false, 'district_attorney', true),
    ('rls-test-ag@cidportal.test', 'justice', null, null, false, 'attorney_general', true),
    ('rls-test-judge@cidportal.test', 'justice', null, null, false, 'judge', true),
    ('rls-test-judge2@cidportal.test', 'justice', null, null, false, 'judge', true),
    ('rls-test-justice@cidportal.test', 'justice', null, null, false, null, null))
  select coalesce(jsonb_agg(jsonb_build_object(
           'email', e.email,
           'present', u.id is not null,
           'issues', (
             select coalesce(jsonb_agg(issue), '[]'::jsonb) from (
               select 'missing account' as issue where u.id is null
               union all select 'missing profile' where u.id is not null and p.id is null
               union all select 'unexpected CID role: ' || p.role::text
                 where p.id is not null and e.exp_role is not null and p.role::text is distinct from e.exp_role
               union all select 'unexpected bureau: ' || p.division::text
                 where p.id is not null and e.exp_division is not null and p.division::text is distinct from e.exp_division
               union all select 'CID active flag is ' || p.active::text
                 where p.id is not null and e.exp_cid_active is not null and p.active is distinct from e.exp_cid_active
               union all select 'login denied' where coalesce(p.login_denied, false)
               union all select 'removed' where p.removed_at is not null
               union all select 'unexpected justice role: ' || coalesce(jm.justice_role, 'none')
                 where u.id is not null and e.kind = 'justice'
                   and coalesce(jm.justice_role, '') is distinct from coalesce(e.exp_justice_role, '')
               union all select 'justice membership inactive'
                 where e.exp_justice_active is true and coalesce(jm.active, false) = false
             ) issues)) order by e.email), '[]'::jsonb)
    into v_fixtures
    from expected e
    left join auth.users u on u.email = e.email
    left join public.profiles p on p.id = u.id
    left join public.justice_memberships jm on jm.user_id = u.id;

  select coalesce(array_agg(id), '{}') into test_ids
    from auth.users where email like 'rls-test-%@cidportal.test';
  select jsonb_build_object(
    'cases', (select count(*) from public.cases where created_by = any(test_ids)),
    'legal_requests', (select count(*) from public.legal_requests where created_by = any(test_ids)),
    'prosecutor_assignments', (select count(*) from public.prosecutor_bureau_assignments
                                where (prosecutor_id = any(test_ids) or assigned_by = any(test_ids)) and ends_at is null),
    'announcements', (select count(*) from public.announcements where author_id = any(test_ids)),
    'membership_requests', (select count(*) from public.membership_requests where applicant_id = any(test_ids)),
    'justice_requests', (select count(*) from public.justice_membership_requests where applicant_id = any(test_ids)),
    'persons', (select count(*) from public.persons where created_by = any(test_ids)))
    into v_leftovers;

  insert into public.audit_log (actor_id, action, entity, entity_id)
  values ((select auth.uid()), 'SECURITY_OVERVIEW_VIEWED', 'security_test_runs', null);

  return jsonb_build_object('runs', v_runs, 'fixtures', v_fixtures, 'leftovers', v_leftovers);
end $$;

-- SIB-native investigations are opened in the Special Investigations Bureau.
create or replace function public.siu_create_case(p_title text, p_summary text default null::text, p_classification text default 'siu'::text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_id uuid;
  v_number text;
begin
  if not private.siu_is_agent() then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_title), '') = '' then raise exception 'a title is required'; end if;
  if p_classification not in ('siu', 'siu_restricted', 'siu_command', 'siu_compartmented') then
    raise exception 'unknown SIB classification';
  end if;

  v_number := public.next_siu_case_number();
  insert into public.cases (case_number, title, summary, bureau, status,
                            lead_detective_id, created_by, case_authority, siu_classification)
  values (v_number, btrim(p_title), nullif(btrim(coalesce(p_summary, '')), ''),
          'special_investigations', 'open', v_actor, v_actor, 'siu', p_classification)
  returning id into v_id;

  insert into public.siu_case_agents (case_id, user_id, agent_role, assigned_by)
  values (v_id, v_actor, 'lead', v_actor);

  if p_classification = 'siu_compartmented' then
    insert into public.siu_compartment_members (case_id, user_id, granted_by, reason)
    values (v_id, v_actor, v_actor, 'Opened the compartmented investigation');
  end if;

  perform private.siu_audit('SIU_CASE_CREATED', v_id, jsonb_build_object(
    'case_number', v_number, 'classification', p_classification));
  return v_id;
end $$;

create or replace function public.review_legal_request_as_cid(p_request uuid, p_decision text, p_note text default null::text, p_override_reason text default null::text, p_signature text default null::text)
returns public.legal_requests
language plpgsql security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_ver uuid;
        v_exhibits integer; v_prosecutors integer := 0; rec record;
        me public.profiles; c public.cases; v_fallback boolean; v_jtf_any boolean;
        v_siu boolean; v_stage text; v_returned text; v_ags integer := 0;
        v_rank text;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  v_siu := private.legal_is_siu(p_request);
  v_stage := case when v_siu then 'siu_command_review' else 'cid_supervisor_review' end;
  v_returned := case when v_siu then 'returned_by_siu_command' else 'returned_by_cid' end;
  if r.review_status <> v_stage then
    raise exception 'request is not awaiting % review', case when v_siu then 'SIB command' else 'CID' end;
  end if;
  if not private.can_approve_legal(p_request, v_uid) then
    raise exception 'only % may decide this request',
      case when v_siu then 'SIB command' else 'Bureau Lead or above' end;
  end if;
  if p_decision not in ('approve', 'deny', 'return') then raise exception 'invalid decision'; end if;
  select * into me from public.profiles where id = v_uid;
  select * into c from public.cases where id = r.case_id;
  -- The rank held right now, frozen into the record. Owner is not a CID rank,
  -- so it is named separately rather than mislabelled as one.
  v_rank := case when coalesce(me.is_owner, false) and me.role is null then 'owner'
                 else me.role end;
  v_jtf_any := (not v_siu) and (me.role = 'bureau_lead' and c.bureau = 'JTF' and me.division <> r.responsible_bureau);
  v_fallback := (not v_siu) and not (me.role = 'bureau_lead' and me.division = r.responsible_bureau) and not v_jtf_any;

  if p_decision = 'return' then
    if btrim(coalesce(p_note, '')) = '' then raise exception 'a return requires a note'; end if;
    update public.legal_requests
       set review_status = v_returned, document_status = 'reopened'
     where id = p_request returning * into r;
    perform private.legal_log(p_request, r.current_version_id, v_returned,
      v_stage, v_returned, p_note, null);
    perform private.legal_audit(p_request,
      case when v_siu then 'LEGAL_RETURNED_BY_SIU_COMMAND' else 'LEGAL_RETURNED_BY_CID' end,
      jsonb_build_object('note', left(p_note, 200), 'fallback', v_fallback,
                         'jtf_any_lead', v_jtf_any, 'actor_rank', v_rank));
    perform private.legal_notify(r.created_by, p_request, 'legal_update',
      'Your ' || r.request_type || ' request was returned by '
      || case when v_siu then 'SIB command' else 'CID review' end || '.');
    return r;
  end if;

  if p_decision = 'deny' then
    if btrim(coalesce(p_note, '')) = '' then raise exception 'a denial requires a note'; end if;
    update public.legal_requests
       set decision = 'denied', decision_note = p_note,
           decided_by = v_uid, decided_at = now(),
           review_status = 'denied',
           cid_reviewed_role = v_rank
     where id = p_request returning * into r;
    v_ver := private.legal_freeze_version(p_request, 'denied');
    select * into r from public.legal_requests where id = p_request;
    perform private.legal_log(p_request, v_ver, 'denied', v_stage, 'denied', p_note, null);
    perform private.legal_audit(p_request, 'LEGAL_DENIED_BY_COMMAND',
      jsonb_build_object('version', v_ver, 'note', left(p_note, 200),
                         'siu', v_siu, 'fallback', v_fallback,
                         'jtf_any_lead', v_jtf_any, 'actor_rank', v_rank));
    perform private.legal_notify(r.created_by, p_request, 'legal_decision',
      'Your ' || r.request_type || ' request was denied by command.');
    return r;
  end if;

  if r.source_report_id is not null
     and not exists (select 1 from public.reports rp where rp.id = r.source_report_id and rp.finalized) then
    raise exception 'the source report must be finalized before approval';
  end if;
  select count(*) into v_exhibits from public.legal_request_exhibits where legal_request_id = p_request;
  if v_exhibits = 0 and btrim(coalesce(p_override_reason, '')) = '' then
    raise exception 'at least one supporting item is required (or record an override reason)';
  end if;

  if v_siu then
    update public.legal_requests
       set cid_reviewed_by = v_uid, cid_reviewed_at = now(),
           cid_reviewed_role = v_rank,
           review_status = 'ag_review',
           submitted_to_doj_at = coalesce(submitted_to_doj_at, now()),
           queue_entered_at = now(),
           assigned_prosecutor_id = null, prosecutor_claimed_at = null
     where id = p_request returning * into r;
    v_ver := private.legal_freeze_version(p_request, 'siu_command_approved');
    select * into r from public.legal_requests where id = p_request;
    perform private.legal_sign(p_request, v_ver, 'siu_command_approval', p_signature);
    perform private.legal_add_participant(p_request, v_uid, 'cid_supervisor');
    perform private.legal_log(p_request, v_ver, 'siu_command_approved',
      'siu_command_review', 'ag_review', p_note,
      nullif(btrim(coalesce(p_override_reason, '')), ''));
    if v_exhibits = 0 then
      perform private.legal_log(p_request, v_ver, 'packet_override', null, null,
        'Approved without supporting items: ' || p_override_reason, null);
    end if;
    perform private.legal_audit(p_request, 'LEGAL_APPROVED_BY_SIU_COMMAND',
      jsonb_build_object('version', v_ver, 'packet_override', v_exhibits = 0,
                         'to', 'ag_review', 'actor_rank', v_rank));
    perform private.legal_notify(r.created_by, p_request, 'legal_update',
      'Your ' || r.request_type || ' request passed SIB command review and is with the Attorney General.');
    for rec in
      select p.id from public.profiles p
       where coalesce(private.justice_role_effective(p.id) = 'attorney_general', false)
    loop
      v_ags := v_ags + 1;
      perform private.legal_notify(rec.id, p_request, 'legal_request',
        'An SIB ' || r.request_type || ' request awaits Attorney General review.');
    end loop;
    if v_ags = 0 then
      for rec in
        select p.id from public.profiles p where p.is_owner and p.removed_at is null
      loop
        perform private.legal_notify(rec.id, p_request, 'legal_coverage',
          'An SIB legal request is with the Attorney General, and no Attorney General is seated.');
      end loop;
      perform private.legal_audit(p_request, 'LEGAL_AG_UNCOVERED',
        jsonb_build_object('version', v_ver));
    end if;
    return r;
  end if;

  update public.legal_requests
     set cid_reviewed_by = v_uid, cid_reviewed_at = now(),
         cid_reviewed_role = v_rank,
         review_status = 'prosecutor_queue',
         submitted_to_doj_at = coalesce(submitted_to_doj_at, now()),
         queue_entered_at = now(),
         assigned_prosecutor_id = null, prosecutor_claimed_at = null
   where id = p_request returning * into r;
  v_ver := private.legal_freeze_version(p_request, 'cid_approved');
  select * into r from public.legal_requests where id = p_request;
  perform private.legal_sign(p_request, v_ver, 'cid_supervisor_approval', p_signature);
  perform private.legal_add_participant(p_request, v_uid, 'cid_supervisor');
  perform private.legal_log(p_request, v_ver, 'cid_approved',
    'cid_supervisor_review', 'prosecutor_queue', p_note,
    nullif(btrim(coalesce(p_override_reason, '')), ''));
  if v_jtf_any then
    perform private.legal_log(p_request, v_ver, 'command_fallback', null, null,
      'Approved by a Bureau Lead from another bureau, permitted because the case is JTF.', null);
  elsif v_fallback then
    perform private.legal_log(p_request, v_ver, 'command_fallback', null, null,
      'Approved by command standing in for the ' || private.bureau_label(r.responsible_bureau::text) || ' Bureau Lead.', null);
  end if;
  if v_exhibits = 0 then
    perform private.legal_log(p_request, v_ver, 'packet_override', null, null,
      'Approved without supporting items: ' || p_override_reason, null);
  end if;
  perform private.legal_audit(p_request, 'LEGAL_APPROVED_BY_COMMAND',
    jsonb_build_object('version', v_ver, 'bureau', r.responsible_bureau,
                       'packet_override', v_exhibits = 0, 'to', 'prosecutor_queue',
                       'fallback', v_fallback, 'jtf_any_lead', v_jtf_any,
                       'actor_rank', v_rank));
  perform private.legal_notify(r.created_by, p_request, 'legal_update',
    'Your ' || r.request_type || ' request passed CID review and entered the ' || private.bureau_label(r.responsible_bureau::text) || ' prosecutor queue.');
  if r.classification <> 'sealed' then
    for rec in
      select m.user_id from public.justice_memberships m
       where m.active and (m.expires_at is null or m.expires_at > now())
         and m.justice_role in ('prosecutor', 'assistant_district_attorney', 'district_attorney')
         and r.responsible_bureau = any (private.prosecutor_bureaus_of(m.user_id))
    loop
      v_prosecutors := v_prosecutors + 1;
      perform private.legal_notify(rec.user_id, p_request, 'legal_request',
        'A ' || r.request_type || ' request entered the ' || private.bureau_label(r.responsible_bureau::text) || ' prosecutor queue.');
    end loop;
  end if;
  if v_prosecutors = 0 then
    for rec in
      select p.id from public.profiles p
       where (p.is_owner and p.removed_at is null)
          or coalesce(private.justice_role_effective(p.id) = 'attorney_general', false)
    loop
      perform private.legal_notify(rec.id, p_request, 'legal_coverage',
        'The ' || private.bureau_label(r.responsible_bureau::text) || ' prosecutor queue has no covering prosecutor.');
    end loop;
  end if;
  return r;
end $$;

create or replace function public.submit_legal_request_to_cid(p_request uuid, p_change_summary text default null::text, p_material_change boolean default false)
returns public.legal_requests
language plpgsql security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_ver uuid; sup record;
        v_fast boolean; v_from text; v_n int := 0; v_siu boolean; c public.cases;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.created_by <> v_uid then raise exception 'only the requesting investigator may submit'; end if;
  if not private.can_edit_legal_draft(p_request, v_uid) then
    raise exception 'this request is not in an editable state';
  end if;
  if btrim(coalesce(r.title, '')) = '' or btrim(coalesce(r.narrative, '')) = '' then
    raise exception 'a title and a description/justification are required';
  end if;
  if r.request_type = 'warrant' then
    if r.priority is null then raise exception 'a warrant requires a priority'; end if;
    if r.subtype = 'arrest_warrant' and r.person_id is null then
      raise exception 'an arrest warrant requires a linked suspect';
    end if;
    if r.subtype = 'search_warrant'
       and r.person_id is null
       and nullif(btrim(coalesce(r.form_data->>'search_targets', '')), '') is null then
      raise exception 'a search warrant requires a subject or at least one search target';
    end if;
  end if;
  if r.request_type = 'subpoena' and r.recipient_type = 'entity'
     and btrim(coalesce(r.recipient_name, '')) = '' then
    raise exception 'a recipient is required';
  end if;

  v_siu := private.legal_is_siu(p_request);
  select * into c from public.cases where id = r.case_id;
  v_from := r.review_status;
  v_fast := (not v_siu)
            and v_from in ('returned_by_judge', 'returned_by_prosecutor')
            and not coalesce(p_material_change, false);

  if r.review_status like 'returned_by_%' and r.assigned_judge_id is not null then
    update public.legal_request_participants
       set removed_at = now(), removed_by = v_uid
     where legal_request_id = p_request and participant_role = 'judicial_reviewer'
       and user_id = r.assigned_judge_id and removed_at is null;
    update public.legal_requests set assigned_judge_id = null where id = p_request;
  end if;

  update public.legal_requests
     set responsible_bureau = private.legal_resolve_bureau(r.case_id)
   where id = p_request;

  if v_fast then
    v_ver := private.legal_freeze_version(p_request, 'prosecutor_queue', p_change_summary);
    update public.legal_requests
       set document_status = 'finalized', review_status = 'prosecutor_queue',
           queue_entered_at = now(),
           assigned_prosecutor_id = null, prosecutor_claimed_at = null,
           submitted_to_cid_at = coalesce(submitted_to_cid_at, now())
     where id = p_request returning * into r;
    perform private.legal_log(p_request, v_ver, 'resubmitted_to_prosecutor',
      v_from, 'prosecutor_queue', p_change_summary, null);
    perform private.legal_audit(p_request, 'LEGAL_RESUBMITTED_TO_PROSECUTOR',
      jsonb_build_object('version', v_ver, 'from', v_from));
    for sup in
      select m.user_id from public.justice_memberships m
       where m.active and (m.expires_at is null or m.expires_at > now())
         and m.justice_role in ('prosecutor', 'assistant_district_attorney', 'district_attorney')
         and r.responsible_bureau = any (private.prosecutor_bureaus_of(m.user_id))
         and r.classification <> 'sealed'
    loop
      v_n := v_n + 1;
      perform private.legal_notify(sup.user_id, p_request, 'legal_request',
        'A corrected ' || r.request_type || ' request re-entered the ' || private.bureau_label(r.responsible_bureau::text) || ' prosecutor queue.');
    end loop;
    return r;
  end if;

  if coalesce(p_material_change, false) then
    perform private.legal_log(p_request, null, 'material_change_declared',
      v_from, null, 'The investigator declared a material change - renewed command review required.', null);
  end if;

  if v_siu then
    v_ver := private.legal_freeze_version(p_request, 'siu_command_review', p_change_summary);
    update public.legal_requests
       set document_status = 'finalized', review_status = 'siu_command_review',
           submitted_to_cid_at = now()
     where id = p_request returning * into r;
    perform private.legal_log(p_request, v_ver, 'submitted_to_siu_command',
      v_from, 'siu_command_review', null, null);
    perform private.legal_audit(p_request, 'LEGAL_SUBMITTED_TO_SIU_COMMAND',
      jsonb_build_object('version', v_ver, 'material_change', coalesce(p_material_change, false)));
    for sup in
      select m.user_id from public.siu_memberships m
       where m.active and m.ended_at is null
         and m.siu_role = 'special_agent_in_charge'
         and not m.oversight_only
         and m.user_id <> v_uid
         and not private.siu_recused(r.case_id, m.user_id)
         and (coalesce(c.siu_classification, 'siu') <> 'siu_compartmented'
              or exists (select 1 from public.siu_compartment_members k
                          where k.case_id = r.case_id and k.user_id = m.user_id
                            and k.revoked_at is null))
    loop
      v_n := v_n + 1;
      perform private.legal_notify(sup.user_id, p_request, 'legal_request',
        'A ' || r.request_type || ' request awaits SIB command review.');
    end loop;
    if v_n = 0 then
      for sup in
        select p.id from public.profiles p
         where coalesce(private.justice_role_effective(p.id) = 'attorney_general', false)
      loop
        perform private.legal_notify(sup.id, p_request, 'legal_coverage',
          'An SIB legal request has no available SIB command reviewer.');
      end loop;
      perform private.legal_audit(p_request, 'LEGAL_SIU_COMMAND_UNCOVERED',
        jsonb_build_object('version', v_ver));
    end if;
    return r;
  end if;

  v_ver := private.legal_freeze_version(p_request, 'cid_supervisor_review', p_change_summary);
  update public.legal_requests
     set document_status = 'finalized', review_status = 'cid_supervisor_review',
         submitted_to_cid_at = now()
   where id = p_request returning * into r;
  perform private.legal_log(p_request, v_ver, 'submitted_to_cid', v_from, 'cid_supervisor_review', null, null);
  perform private.legal_audit(p_request, 'LEGAL_SUBMITTED_TO_CID',
    jsonb_build_object('version', v_ver, 'material_change', coalesce(p_material_change, false)));
  for sup in
    select p.id from public.profiles p
    where p.active and p.removed_at is null and p.id <> v_uid
      and ((p.role in ('senior_detective', 'bureau_lead') and p.division = r.responsible_bureau)
           or p.role in ('deputy_director', 'director'))
  loop
    perform private.legal_notify(sup.id, p_request, 'legal_request',
      'A ' || r.request_type || ' request awaits CID supervisor review.');
  end loop;
  return r;
end $$;

create or replace function public.siu_review_referral(p_referral uuid, p_disposition text, p_note text, p_open_as text default 'preliminary_inquiry'::text, p_classification text default 'siu_restricted'::text, p_category text default null::text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_ref record;
  v_case uuid;
  v_number text;
begin
  if not private.siu_is_agent() then raise exception 'not authorized'; end if;
  if p_disposition not in ('under_review','accepted','declined','referred_to_cid',
                           'info_requested','withdrawn') then
    raise exception 'unknown disposition';
  end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'a review note is required'; end if;

  select * into v_ref from public.siu_referrals where id = p_referral for update;
  if not found then raise exception 'referral not found'; end if;
  if v_ref.opened_case_id is not null then
    raise exception 'this referral has already been actioned';
  end if;

  if p_disposition = 'accepted' then
    if p_open_as not in ('preliminary_inquiry','investigation') then
      raise exception 'unknown opening stage';
    end if;
    if p_classification not in ('siu','siu_restricted','siu_command','siu_compartmented') then
      raise exception 'unknown SIB classification';
    end if;

    v_number := public.next_siu_case_number();
    insert into public.cases (case_number, title, summary, bureau, status,
                              lead_detective_id, created_by, case_authority,
                              siu_classification, siu_stage, siu_category)
    values (v_number,
            left(v_ref.summary, 200),
            v_ref.detail,
            'special_investigations', 'open', v_actor, v_actor, 'siu',
            p_classification, p_open_as, p_category)
    returning id into v_case;

    insert into public.siu_case_agents (case_id, user_id, agent_role, assigned_by)
    values (v_case, v_actor, 'lead', v_actor);

    if p_classification = 'siu_compartmented' then
      insert into public.siu_compartment_members (case_id, user_id, granted_by, reason)
      values (v_case, v_actor, v_actor, 'Opened from referral');
    end if;
  end if;

  update public.siu_referrals
     set status = p_disposition, review_note = btrim(p_note),
         reviewed_by = v_actor, reviewed_at = now(),
         opened_case_id = coalesce(v_case, opened_case_id)
   where id = p_referral;

  perform private.siu_audit('SIU_REFERRAL_REVIEWED', p_referral, jsonb_build_object(
    'disposition', p_disposition, 'note', btrim(p_note),
    'opened_case', v_case, 'opened_as', case when v_case is not null then p_open_as end,
    'classification', case when v_case is not null then p_classification end,
    'reviewed_by', v_actor));
  return v_case;
end $$;
