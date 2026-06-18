-- ============================================================================
-- Reconcile "Live CID Records" into the main auth/RLS model (Wave 0).
--
-- Previously cid_records was world-readable (anon SELECT USING true) and served
-- by a SEPARATE Supabase client + Discord/email auth in records.js. records.js
-- now rides the MAIN client (window.CIDDB) and the app's single sign-in, so anon
-- read is no longer needed and is closed here.
--
-- DEPLOY COUPLING: apply this migration together with the records.js change in
-- the same release. Applying it while the old (anon-client) records.js is still
-- live would leave the Records tab unable to read. Existing rows (incl. the two
-- seed rows with NULL created_by) are preserved; the seed rows become editable
-- by command staff and remain visible to all active members.
--
-- auth.uid()/helper calls are wrapped in (select ...) so the policies are not
-- re-evaluated per row (avoids the auth_rls_initplan performance lint).
-- ============================================================================

alter table public.cid_records enable row level security;  -- already on; idempotent

drop policy if exists cid_read   on public.cid_records;
drop policy if exists cid_insert on public.cid_records;
drop policy if exists cid_update on public.cid_records;
drop policy if exists cid_delete on public.cid_records;

-- Read: active members only (no more anonymous access).
create policy cid_read on public.cid_records
  for select to authenticated
  using ( (select private.is_active()) );

-- Insert: active members; row must be stamped with the creator's own id.
create policy cid_insert on public.cid_records
  for insert to authenticated
  with check ( (select private.is_active()) and created_by = (select auth.uid()) );

-- Update: active members; owners edit their own rows, command may edit any
-- (so the legacy NULL-owner seed rows are maintainable).
create policy cid_update on public.cid_records
  for update to authenticated
  using ( (select private.is_active()) and ( created_by = (select auth.uid()) or (select private.is_command()) ) )
  with check ( (select private.is_active()) and ( created_by = (select auth.uid()) or (select private.is_command()) ) );

-- Delete: command staff only, consistent with the rest of the platform.
create policy cid_delete on public.cid_records
  for delete to authenticated
  using ( (select private.can_delete()) );
