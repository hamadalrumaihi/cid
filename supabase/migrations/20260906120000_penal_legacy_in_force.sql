-- ============================================================================
-- The code the portal actually serves is marked as the one in force.
--
-- 20260905120000 imported the legacy code as 'superseded', which was right at
-- the time: it existed only so historical charges had a version to resolve
-- against. But nothing has superseded it. Every user of the portal is served
-- those 162 statutes right now, out of the hard-coded array in
-- src/lib/penal.ts, and the 2026 code is an unpublished draft nobody has
-- enacted. So the database says "no code is in force" while the application
-- serves one, and those cannot both be true.
--
-- This corrects the record. It does NOT change what any user sees: the charges
-- being published are byte-for-byte the ones the client already renders, and
-- this migration was verified against that array by digest before it ran.
--
-- ── Why this has to happen before the selectors can move ──────────────────
-- public.penal_current_charges() reads `where v.status = 'published'`. With no
-- published version it returns nothing, so pointing PenalView, the charge
-- picker or global search at it would empty the penal code rather than move
-- it. Publishing the code that is genuinely in force is the honest way to make
-- that query correct; teaching the query to fall back to the newest non-draft
-- version would hide the absence of an enacted code, which is exactly the
-- thing the status column exists to make visible.
--
-- ── Why not publish the 2026 code instead ─────────────────────────────────
-- That would change the law in force, which is a decision for a Penal Code
-- administrator and not a side effect of a deployment. Two of its charges
-- still have no code. It stays a draft, and publishing it stays a deliberate,
-- audited act through penal_publish_version() once there is a surface for it.
--
-- ── Why the RPC is not called ─────────────────────────────────────────────
-- penal_publish_version() gates on private.penal_is_admin(), which resolves
-- through auth.uid(). A migration has no authenticated user, so the RPC would
-- refuse. The side effects are therefore reproduced here EXACTLY as that
-- function performs them -- status, published_at, superseded_at cleared, the
-- previous published version stepped down, and the same
-- PENAL_VERSION_PUBLISHED audit action -- with actor_id NULL, because no
-- person published this and recording one would be a lie about who decided.
--
-- The guards the RPC applies are reproduced too, and this migration RAISES
-- rather than proceeding if any of them fails.
--
-- APPLICATION NOTE: applied live as penal_legacy_in_force.
-- ============================================================================

do $publish$
declare
  v public.penal_code_versions;
  v_prev uuid;
  v_active int;
  v_drafts int;
begin
  select * into v from public.penal_code_versions
   where name = 'San Andreas Penal Code (legacy)' for update;
  if not found then
    raise exception 'the legacy penal code version is missing';
  end if;
  if v.status = 'published' then
    -- Already done; nothing to correct.
    return;
  end if;

  -- Same guard penal_publish_version() applies: a version with no active
  -- charges is not a penal code.
  select count(*) into v_active from public.penal_charges
   where version_id = v.id and lifecycle = 'active';
  if v_active = 0 then
    raise exception 'the legacy version has no active charges';
  end if;
  if v_active <> 162 then
    raise exception 'expected 162 active legacy charges, found % -- refusing to publish a code that is not the one that was imported', v_active;
  end if;
  select count(*) into v_drafts from public.penal_charges
   where version_id = v.id and needs_code;
  if v_drafts <> 0 then
    raise exception 'the legacy version has % charges without codes', v_drafts;
  end if;

  -- There must be no other published version; penal_code_versions_one_published
  -- would refuse anyway, but failing here says why.
  select id into v_prev from public.penal_code_versions where status = 'published';
  if v_prev is not null then
    raise exception 'another version is already published (%) -- this migration will not step it down', v_prev;
  end if;

  update public.penal_code_versions
     set status = 'published',
         published_by = null,
         published_at = now(),
         superseded_at = null,
         updated_at = now()
   where id = v.id;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (null, 'PENAL_VERSION_PUBLISHED', 'penal_code_versions', v.id,
          jsonb_build_object(
            'name', v.name,
            'effective_date', v.effective_date,
            'previous_version', null,
            'active_charges', v_active,
            'charges_needing_codes', v_drafts,
            'note', 'Published by migration, not by a person: this is the code '
                 || 'the portal was already serving from src/lib/penal.ts, and '
                 || 'the database recorded no version in force. Corrects the '
                 || 'record; changes nothing any user sees.'));
end $publish$;

-- ============================================================================
-- Rollback: set the legacy version back to 'superseded' with superseded_at =
-- now() and published_at = null. Doing so empties penal_current_charges()
-- again, so any selector reading it must be reverted in the same change.
-- ============================================================================
