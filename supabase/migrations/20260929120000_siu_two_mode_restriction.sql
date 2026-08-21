-- ============================================================================
-- Two ways to restrict, and a wider set of people who may do it.
--
-- S1 gave the registry a single answer: a record was SIU's or it was not. That
-- is too blunt for the common case, which is a person CID has known for months
-- who becomes the subject of an SIU file. Hiding them removes CID's own work;
-- leaving everything visible exposes the investigation. So there are now two
-- restrictions, and they are named for what they actually do:
--
--   scope = 'record'    the record and everything under it leaves CID
--   scope = 'sections'  the record stays; named sections leave CID
--
-- WHO MAY DO IT -- AND THE TRAP IN ASKING
-- All three SIU ranks (special_agent, senior_special_agent,
-- special_agent_in_charge), the Director, and the Owner.
--
-- private.siu_is_command() is NOT that set: it is ('owner',
-- 'special_agent_in_charge') -- X-1 and the Owner only. Nor can the Director be
-- reached through private.siu_standing(), which returns NULL for them by
-- deliberate design: migration 20260902120000 removed the director branch
-- precisely so that the head of CID could not command the unit that
-- investigates CID. So the Director is checked against profiles.role directly.
-- One function, private.siu_may_control_visibility(), is the only definition.
--
-- WHAT INCLUDING THE DIRECTOR COSTS
-- You cannot release what you cannot see -- the confirmation screen has to show
-- the record, its author and its CID dependencies -- so control implies read.
-- The Director therefore sees compartmented REGISTRY material: restricted
-- persons, gangs, vehicles, places, accounts, indicators and their links. They
-- do NOT gain SIU case material: siu_targets, siu_case_notes, siu_sources,
-- siu_watchlist and the rest keep their own predicates, untouched by this
-- migration. That containment is the difference between "the Director can
-- audit what SIU hid from CID" and "the Director can read the file on
-- themselves".
--
-- THE SECOND CONFIRMATION IS A SERVER-SIDE ARGUMENT
-- Restricting a whole record that CID already built on is permitted, and it is
-- consequential: CID loses access to its own material. A confirmation dialog
-- enforces nothing, so the acknowledgement is a parameter. Without
-- p_acknowledge_cid_impact the RPC refuses and returns the impact, which is
-- also what the UI renders. (S1 refused this outright; the brief asks for warn
-- and confirm, and this is that, enforced where it cannot be skipped.)
--
-- APPLICATION NOTE: applied live as siu_two_mode_restriction.
-- ============================================================================

-- -- 1. The one authorization function --------------------------------------------------
create or replace function private.siu_may_control_visibility()
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(
    private.siu_standing() in
      ('owner', 'special_agent', 'senior_special_agent', 'special_agent_in_charge')
    or (select p.active and p.removed_at is null and p.role = 'director'
          from public.profiles p where p.id = (select auth.uid())),
    false)
$$;
revoke all on function private.siu_may_control_visibility() from public;
grant execute on function private.siu_may_control_visibility()
  to authenticated, service_role;

-- Who is not hidden FROM. Oversight (the Attorney General) reads SIU material
-- and so is included through siu_operates(); it still may not restrict or
-- reveal, which is a separate question answered above.
create or replace function private.siu_sees_compartmented()
returns boolean language sql stable security definer set search_path to '' as $$
  select private.siu_operates() or private.siu_may_control_visibility()
$$;
revoke all on function private.siu_sees_compartmented() from public;
grant execute on function private.siu_sees_compartmented() to authenticated, service_role;

-- -- 2. The ledger learns about scope and sections ---------------------------------------
alter table public.siu_visibility
  add column if not exists scope text not null default 'record';
alter table public.siu_visibility
  add column if not exists hidden_sections text[] not null default '{}';

alter table public.siu_visibility
  drop constraint if exists siu_visibility_scope_check;
alter table public.siu_visibility
  add constraint siu_visibility_scope_check
  check (scope in ('record', 'sections'));

-- A section-scoped restriction that names no section restricts nothing. That is
-- a configuration mistake, not a policy, and it would read on screen as "this
-- is protected" while protecting nothing.
alter table public.siu_visibility
  drop constraint if exists siu_visibility_sections_named_check;
alter table public.siu_visibility
  add constraint siu_visibility_sections_named_check
  check (scope <> 'sections'
         or state <> 'siu_only'
         or array_length(hidden_sections, 1) >= 1);

-- Accounts and indicators join the registries this covers.
alter table public.siu_visibility
  drop constraint if exists siu_visibility_entity_type_check;
alter table public.siu_visibility
  add constraint siu_visibility_entity_type_check
  check (entity_type in (
    'person', 'vehicle', 'gang', 'place', 'account', 'indicator',
    'case', 'intelligence', 'target', 'report', 'note', 'evidence', 'media',
    'task', 'legal_request', 'timeline_event', 'relationship', 'alert',
    'comment', 'activity'));

-- -- 3. The predicate, now section-aware --------------------------------------------------
-- Pulled out of siu_hidden's body so both it and the section form share one
-- definition of "this release does not reach you".
create or replace function private.siu_audience_excludes(p_case uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select (p_user is not null and p_user is distinct from (select auth.uid()))
      or (p_case is not null and not private.can_access_case(p_case))
$$;
revoke all on function private.siu_audience_excludes(uuid, uuid) from public;
grant execute on function private.siu_audience_excludes(uuid, uuid) to authenticated, service_role;

-- True when this record -- or this SECTION of it -- must be hidden from the
-- caller. p_section null asks about the record itself.
--
-- A null p_id blocks nothing: link tables have nullable endpoints, and a row
-- with no person attached cannot be leaking a person.
create or replace function private.siu_blocked(
  p_type text, p_id uuid, p_section text default null)
returns boolean language sql stable security definer set search_path to '' as $$
  select case
    when p_id is null then false
    when private.siu_sees_compartmented() then false
    else exists (
      select 1 from public.siu_visibility v
       where v.entity_type = p_type and v.entity_id = p_id
         and case v.scope
           -- Mode 1. The record is gone, so everything under it is gone with
           -- it -- asking about a section gets the same answer as asking about
           -- the record.
           when 'record' then
             v.state = 'siu_only'
             or (v.state = 'revealed'
                 and private.siu_audience_excludes(v.revealed_to_case_id, v.revealed_to_user_id))
             -- Partially released: the record itself is visible, and only the
             -- sections named in the release are.
             or (v.state = 'partial' and p_section is not null
                 and not (p_section = any(v.revealed_sections)))
           -- Mode 2. The record stays visible to CID; the named sections do not.
           when 'sections' then
             v.state = 'siu_only'
             and p_section is not null
             and p_section = any(v.hidden_sections)
           else false
         end)
  end
$$;
revoke all on function private.siu_blocked(text, uuid, text) from public;
grant execute on function private.siu_blocked(text, uuid, text) to authenticated, service_role;

-- siu_hidden keeps its S1 signature and meaning -- "is the RECORD itself hidden"
-- -- so the twelve registry policies emitted in S1 need no re-emission.
create or replace function private.siu_hidden(p_type text, p_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select private.siu_blocked(p_type, p_id, null)
$$;
revoke all on function private.siu_hidden(text, uuid) from public;
grant execute on function private.siu_hidden(text, uuid) to authenticated, service_role;

-- ============================================================================
-- Rollback: restore the S1 bodies of siu_may_control_visibility() and
-- siu_hidden(); drop siu_blocked, siu_sees_compartmented and
-- siu_audience_excludes; drop the scope and hidden_sections columns. No row is
-- reclassified by any of this -- every existing ledger row defaults to
-- scope 'record', which is exactly how S1 already behaved.
-- ============================================================================
