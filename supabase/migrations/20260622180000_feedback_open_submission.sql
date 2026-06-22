-- ============================================================================
-- Open the feedback list so any signed-in member can submit a feature request
-- or bug report. The app owner still triages: only the owner can read every
-- submission and change status; members see and withdraw only their own.
-- ============================================================================

drop policy if exists feedback_owner_all on public.feedback;

-- Owner: full read/write/manage on every row.
create policy feedback_owner_manage on public.feedback
  for all to authenticated
  using ( (select auth.uid()) = '25466146-c512-4497-8ee8-88cbf3b1d22d'::uuid )
  with check ( (select auth.uid()) = '25466146-c512-4497-8ee8-88cbf3b1d22d'::uuid );

-- Any signed-in member: submit feedback as themselves.
create policy feedback_insert_own on public.feedback
  for insert to authenticated
  with check ( (select auth.uid()) = created_by );

-- Any signed-in member: read only their own submissions.
create policy feedback_select_own on public.feedback
  for select to authenticated
  using ( (select auth.uid()) = created_by );

-- Any signed-in member: withdraw their own submissions.
create policy feedback_delete_own on public.feedback
  for delete to authenticated
  using ( (select auth.uid()) = created_by );
