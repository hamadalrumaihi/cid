-- ============================================================================
-- penal_current_charges() returns the two facts the client would otherwise
-- lose: RICO predicate eligibility, and whether a charge requires an arrest.
--
-- The selectors are about to stop reading the hard-coded array in
-- src/lib/penal.ts and start reading this function. That array carries a
-- single `rico` flag on 24 charges, and three surfaces consume it:
--
--   RicoTab      populates the predicate-act picker from PENAL_CODE.filter(rico)
--   PenalView    shows a RICO badge
--   ChargesTab   counts "RICO predicates" on a case
--
-- 20260905120000 split that one flag into the two different facts it was
-- conflating: is_rico for the 6 Title 10 RICO MODIFIERS, and is_rico_predicate
-- for the 18 offenses that can serve as a PREDICATE ACT. That split was
-- correct -- they are opposite ends of the same statute -- but this function
-- only ever returned is_rico. Cutting the client over without fixing it would
-- silently shrink the predicate picker from 24 entries to 6 and quietly stop
-- counting Murder, Kidnapping, Robbery, Arson and Bribery as predicates on
-- every RICO case. The UI would look fine and be wrong.
--
-- arrest_required is returned for the same reason: 11 legacy charges carry it
-- and nothing in the database would otherwise hand it to a client.
--
-- ── Why DROP and CREATE rather than CREATE OR REPLACE ─────────────────────
-- The return type is a TABLE(...) and Postgres will not let CREATE OR REPLACE
-- change one. Nothing in SQL depends on this function -- it is called from the
-- client -- so dropping it is safe, but the grants go with it and are
-- reapplied below. It stays SECURITY INVOKER: the caller's own policy decides
-- what they see, and a function that reads the published penal code should not
-- be the thing that widens access to it.
--
-- APPLICATION NOTE: applied live as penal_current_charges_full_facts.
-- ============================================================================

drop function if exists public.penal_current_charges();

create function public.penal_current_charges()
returns table (
  id uuid, version_id uuid, version_name text, code text, offense text,
  penal_title text, charge_class text, stackable boolean,
  fine numeric, jail_months numeric, judge_set_fine boolean, judge_set_jail boolean,
  pd_exempt boolean, definition text, is_modifier boolean, is_rico boolean,
  is_rico_predicate boolean, arrest_required boolean,
  substance_schedule integer, special_notes text, lifecycle text
) language sql stable set search_path to 'public' as $$
  select c.id, c.version_id, v.name, c.code, c.offense,
         c.penal_title, c.charge_class, c.stackable,
         c.fine, c.jail_months, c.judge_set_fine, c.judge_set_jail,
         c.pd_exempt, c.definition, c.is_modifier, c.is_rico,
         c.is_rico_predicate, c.arrest_required,
         c.substance_schedule, c.special_notes, c.lifecycle
    from public.penal_charges c
    join public.penal_code_versions v on v.id = c.version_id
   where v.status = 'published' and c.lifecycle = 'active'
   order by c.penal_title nulls last, c.code nulls last, c.offense
$$;

revoke all on function public.penal_current_charges() from public, anon;
grant execute on function public.penal_current_charges() to authenticated, service_role;

-- ============================================================================
-- Rollback: drop and re-create from 20260904120000, without the two columns.
-- Any client reading them must be reverted in the same change or the predicate
-- picker silently loses 18 of its 24 entries.
-- ============================================================================
