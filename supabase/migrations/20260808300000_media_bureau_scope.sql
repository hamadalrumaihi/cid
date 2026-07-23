-- ─────────────────────────────────────────────────────────────────────────────
-- Media follows CASE ACCESS (owner directive: "same bureau access for cases
-- and media").
--
-- Cases have been bureau-isolated since 20260617140100 (private.can_access_case:
-- JTF / own bureau / lead / creator / explicit grant / command), but the media
-- policies were still portal-wide (is_active() only) — any active member could
-- SELECT another bureau's case media, INSERT media attached to a case they
-- cannot open, or UPDATE its metadata. This re-emits media_sel / media_ins /
-- media_upd with one added conjunct:
--
--     (case_id is null or private.can_access_case(case_id))
--
--   • CASE-ATTACHED media now follows the case wall exactly — same bureau (or
--     JTF / lead / creator / grant / command) sees it, nobody else does.
--   • UNATTACHED media (case_id null — gang packages, general vault uploads)
--     stays visible to all active members, unchanged.
--   • The RESTRICTED tier is untouched and still applies ON TOP of case access:
--     a restricted row needs can_edit_narcotics_intel() or an active
--     break-glass grant even for members of the owning bureau (D6).
--   • media_upd's WITH CHECK carries the same conjunct, so media can neither be
--     edited across the wall NOR re-pointed INTO an inaccessible case.
--   • media_del is unchanged: can_delete() is command (who pass
--     can_access_case everywhere already) and the Phase-2 legal-hold guard
--     stays byte-identical.
--
-- Policy-only change: no columns, no data, no function changes. Bodies below
-- are the live ones (snapshot 5534-5548) plus the single conjunct.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists media_sel on public.media;
create policy media_sel on public.media
  for select to authenticated
  using (
    private.is_active()
    and (case_id is null or private.can_access_case(case_id))
    and ((not restricted)
         or private.can_edit_narcotics_intel()
         or private.has_media_break_glass(case_id, (select auth.uid()))));

drop policy if exists media_ins on public.media;
create policy media_ins on public.media
  for insert to authenticated
  with check (
    private.is_active()
    and (case_id is null or private.can_access_case(case_id)));

drop policy if exists media_upd on public.media;
create policy media_upd on public.media
  for update to authenticated
  using (
    private.is_active()
    and (case_id is null or private.can_access_case(case_id))
    and ((not restricted) or private.can_edit_narcotics_intel()))
  with check (
    private.is_active()
    and (case_id is null or private.can_access_case(case_id))
    and ((not restricted) or private.can_edit_narcotics_intel()));

-- media_del deliberately not re-emitted (command-only + hold guard, unchanged).

-- ============================================================================
-- Rollback (manual): re-create the three policies from the pre-migration
-- bodies (snapshot as of 20260808280000) without the case-access conjunct.
-- ============================================================================
