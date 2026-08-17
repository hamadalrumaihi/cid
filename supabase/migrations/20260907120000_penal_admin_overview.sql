-- ============================================================================
-- One read that tells a Penal Code administrator what there is to administer.
--
-- The publish, rollback, archive and restore RPCs have existed since
-- 20260904120000 and nothing has ever called them: there is no surface. The
-- consequence is concrete -- the 2026 code has been sitting imported and
-- unpublishable, because publishing it requires an authenticated administrator
-- and no screen offers the action.
--
-- This adds the read that such a screen needs. The writes already exist and
-- are not touched.
--
-- -- Why the client cannot just read penal_administrators -------------------
-- It looks like it could: the table lists who may rewrite the law. But
-- penal_admins_sel is USING (private.penal_is_admin()), and penal_is_admin()
-- is `is_owner() OR an appointed administrator`. The Portal Owner is an
-- administrator WITHOUT having a row, so "read the table and see if I am in
-- it" reports the owner as not an administrator -- and today the owner is the
-- only one, since no administrator has ever been appointed. A client that
-- guessed from that table would hide the publish button from the one person
-- entitled to use it.
--
-- So the answer comes from the same function the policies use, asked directly.
--
-- -- SECURITY INVOKER, deliberately ----------------------------------------
-- Every count below is a plain sub-select over penal_charges, penal_rules and
-- penal_substance_schedules, so each one is filtered by that table's own
-- SELECT policy as the CALLER. A non-administrator therefore sees the versions
-- they could already list and no draft, and `is_admin` comes back false. The
-- function grants nothing; it only assembles what the caller may already read.
-- A definer version would have had to restate the visibility rules, and could
-- then disagree with them.
--
-- APPLICATION NOTE: applied live as penal_admin_overview.
-- ============================================================================

create or replace function public.penal_admin_overview()
returns jsonb language sql stable security invoker set search_path to '' as $$
  select jsonb_build_object(
    -- Asked of the same helper the policies use, so the screen and the
    -- database cannot disagree about who is an administrator.
    'is_admin', private.penal_is_admin(),
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', v.id,
               'name', v.name,
               'status', v.status,
               'effective_date', v.effective_date,
               'source_file', v.source_file,
               'change_summary', v.change_summary,
               'published_at', v.published_at,
               'superseded_at', v.superseded_at,
               -- Counted through penal_charges_sel as the caller.
               'active_charges', (select count(*) from public.penal_charges c
                                   where c.version_id = v.id and c.lifecycle = 'active'),
               'draft_charges', (select count(*) from public.penal_charges c
                                  where c.version_id = v.id and c.lifecycle = 'draft'),
               'archived_charges', (select count(*) from public.penal_charges c
                                     where c.version_id = v.id and c.lifecycle = 'archived'),
               -- The number that must be shown before anyone publishes: a
               -- charge with no code cannot be selected, so publishing a
               -- version with these silently ships an incomplete code.
               'needs_code', (select count(*) from public.penal_charges c
                               where c.version_id = v.id and c.needs_code),
               'rules', (select count(*) from public.penal_rules r where r.version_id = v.id),
               'schedules', (select count(*) from public.penal_substance_schedules s
                              where s.version_id = v.id))
             order by v.effective_date desc, v.created_at desc)
        from public.penal_code_versions v), '[]'::jsonb))
$$;

revoke all on function public.penal_admin_overview() from public, anon;
grant execute on function public.penal_admin_overview() to authenticated, service_role;

-- ============================================================================
-- Rollback: drop public.penal_admin_overview(). No table or policy changes to
-- undo; the publish/rollback/archive/restore RPCs are untouched.
-- ============================================================================
