-- ============================================================================
-- CID RECORDS — scope writes to the record owner
-- Supersedes the open insert/update policies from 20260615130000_cid_records.sql.
--
-- Before: any authenticated user could UPDATE *any* row (using/check = true),
--         and INSERT rows with any created_by (check = true).
-- After:  a user may only UPDATE rows they created, and INSERTs are forced to
--         stamp created_by = the caller, so ownership can't be spoofed.
--
-- Read access is unchanged (still public via the cid_read policy).
-- No DELETE policy is added, so deletes remain blocked.
--
-- NOTE on seed/orphan rows: the 2 seed rows (and anything inserted server-side
-- by the migration) have created_by = NULL, so under the strict policy below
-- NO ONE can edit them via the app. To instead let any signed-in user adopt /
-- edit those orphaned rows, use the commented "owner-or-orphan" variant.
-- ============================================================================

-- UPDATE: only the row's creator
drop policy if exists cid_update on public.cid_records;
create policy cid_update on public.cid_records
  for update to authenticated
  using ( auth.uid() = created_by )
  with check ( auth.uid() = created_by );

-- Owner-or-orphan variant (uncomment to allow editing of NULL-owner seed rows):
-- create policy cid_update on public.cid_records
--   for update to authenticated
--   using ( auth.uid() = created_by or created_by is null )
--   with check ( auth.uid() = created_by or created_by is null );

-- INSERT: force the new row to be owned by the caller (no spoofing created_by).
drop policy if exists cid_insert on public.cid_records;
create policy cid_insert on public.cid_records
  for insert to authenticated
  with check ( auth.uid() = created_by );
