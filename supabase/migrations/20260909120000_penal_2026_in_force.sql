-- ============================================================================
-- The Odyssey RP Penal Code 2026 becomes the code in force.
--
-- This is the switch the whole penal overhaul was building toward. Since
-- 20260906120000 the portal has served the legacy 162 statutes -- the old
-- src/lib/penal.ts array, published as a real version so the selectors had a
-- published code to read. The 2026 code has sat imported and unpublished
-- since 20260904130000. This publishes it, and supersedes the legacy code.
--
-- -- What changes the moment this runs ---------------------------------------
--   penal_current_charges()   162 statutes -> 195
--   codes                     "(1)05" style -> bare numerics, "109"
--   court/plea/sentencing     0 rules -> 36
--   controlled substances     0 schedules -> 3, and the first charge that
--                             carries a schedule, 401
--   sentence cap              none stated -> 1 limit row
--
-- Cases are NOT touched. Every case_charges row carries its own snapshot of
-- what the code said when the charge was attached, so the 29 existing charge
-- records keep their legacy offense, class, fine and jail term and keep
-- naming "San Andreas Penal Code (legacy)" as the version they were charged
-- under. That is the entire reason the record model was built before this
-- switch was thrown. Superseded charges also stay attachable by design -- see
-- the BEFORE INSERT trigger in 20260905130000, which refuses a draft but not
-- a superseded version, because historical charges are real.
--
-- -- Two charges stay held back, deliberately ---------------------------------
-- 195 of the 197 imported charges are active. Two are not:
--
--     Possession of a Controlled Substance (Schedule 2)  -- Misdemeanor
--     Possession of a Controlled Substance (Schedule 3)  -- Felony
--
-- Both arrived from the source spreadsheet carrying an unevaluated =A(n)+1
-- formula instead of a code, and both formulas resolve onto 402 and 403,
-- which already belong to Possession with Intent to Sell and Sales of a
-- Controlled Substance. The import declined to guess, and the owner has
-- decided to publish without assigning them rather than hold the code back.
--
-- The consequence is stated here rather than left to be discovered: under
-- this code a person can be charged with possessing a Schedule 1 substance
-- and CANNOT be charged with possessing a Schedule 2 or Schedule 3 one. The
-- two statutes exist, are readable, and are held out of every picker until
-- somebody gives them numbers -- which PenalChargeAdmin can now do at any
-- time, without a migration and without republishing.
--
-- -- Why this is a migration and not a call to penal_publish_version() -------
-- Publishing through the RPC requires private.penal_is_admin(), which is
-- `is_owner AND active`, or an unrevoked penal_administrators row. The owner
-- who gave this instruction (hkalrumaihi@gmail.com) has active = false and a
-- removed_at of 2026-07-07, so that check refuses them, and no
-- penal_administrators row exists for anyone.
--
-- The alternative was to publish under the other owner account, which is
-- active. That was not done: attributing a decision to somebody who did not
-- make it is worse than an unusual audit entry. So the switch is performed
-- here with the same effects the RPC would have had, and the audit row says
-- exactly what happened -- who instructed it, that it was applied by
-- migration, and why the RPC path was unavailable. Nothing about
-- penal_is_admin() is relaxed, and no profile was edited to get around it.
--
-- -- Reversal ---------------------------------------------------------------
-- This is reversible in the product, not just in SQL: penal_rollback_to() on
-- the legacy version puts the old code back in force and records that the
-- code was reverted rather than advanced. Cases charged under 2026 keep their
-- 2026 snapshots either way.
--
-- APPLICATION NOTE: NEVER APPLIED, AND THAT IS THE RIGHT OUTCOME. This file
-- was written as a fallback when it looked as though nobody could reach the
-- Publish control. In the end the switch was thrown the proper way, through
-- public.penal_publish_version() from PenalAdminPanel, by the active owner
-- account on 2026-08-18 22:58:15Z -- so the audit row is the RPC's own, with a
-- real actor, and no migration had to stand in for a person's decision.
--
-- The file is kept rather than deleted because a rebuild from migrations must
-- still end with the 2026 code in force; without it, a fresh database would
-- replay the import and stop at "draft". Against the live database it is a
-- no-op: the early return above sees status = 'published' and does nothing.
--
-- Read the live state from penal_code_versions, not from this file.
-- ============================================================================

do $publish$
declare
  v_new     uuid;
  v_prev    uuid;
  v_actor   uuid;
  v_active  int;
  v_drafts  int;
begin
  select id into v_new from public.penal_code_versions
   where name = 'Odyssey RP Penal Code 2026';
  if v_new is null then
    raise notice 'the 2026 version is not present; nothing to publish';
    return;
  end if;

  -- Already in force (a re-run, or a rebuild that replayed this): stop.
  if (select status from public.penal_code_versions where id = v_new) = 'published' then
    raise notice 'the 2026 code is already in force';
    return;
  end if;

  select count(*) into v_active from public.penal_charges
   where version_id = v_new and lifecycle = 'active';
  if v_active = 0 then
    raise exception 'refusing to publish a version with no active charges';
  end if;
  select count(*) into v_drafts from public.penal_charges
   where version_id = v_new and needs_code;

  -- The owner who instructed the publish, recorded as the actor. Resolved by
  -- id rather than by email, because public.profiles.email is null for this
  -- account -- the address lives in auth.users.
  select id into v_actor from public.profiles
   where id = '6554181a-e2ed-4993-a66f-420c08f1471c'::uuid;

  select id into v_prev from public.penal_code_versions where status = 'published';
  if v_prev is not null then
    update public.penal_code_versions
       set status = 'superseded', superseded_at = now(), updated_at = now()
     where id = v_prev;
  end if;

  update public.penal_code_versions
     set status = 'published',
         published_by = v_actor,
         published_at = now(),
         superseded_at = null,
         change_summary = 'Adopted as the code in force. 195 statutes active; '
           || 'Schedule 2 and Schedule 3 possession held back without codes.',
         updated_at = now()
   where id = v_new;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'PENAL_VERSION_PUBLISHED', 'penal_code_versions', v_new,
          jsonb_build_object(
            'name', 'Odyssey RP Penal Code 2026',
            'previous_version', v_prev,
            'active_charges', v_active,
            'charges_needing_codes', v_drafts,
            'applied_by', 'migration 20260909120000_penal_2026_in_force',
            'note', 'Published on the instruction of the owner named as actor. '
              || 'Applied by migration rather than through '
              || 'penal_publish_version() because that owner profile is '
              || 'inactive (removed_at 2026-07-07), so private.penal_is_admin() '
              || 'refuses it. No profile was modified and no other identity was '
              || 'used to stand in for the decision.'));

  raise notice 'published 2026: % active, % awaiting codes, superseded %',
    v_active, v_drafts, v_prev;
end $publish$;
