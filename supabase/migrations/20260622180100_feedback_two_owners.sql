-- ============================================================================
-- Both accounts (Tom wood / H K) belong to the app owner; either one may triage
-- feedback. Widen the owner-manage policy to recognise both uids.
-- ============================================================================

drop policy if exists feedback_owner_manage on public.feedback;
create policy feedback_owner_manage on public.feedback
  for all to authenticated
  using ( (select auth.uid()) in (
    '25466146-c512-4497-8ee8-88cbf3b1d22d'::uuid,
    '6554181a-e2ed-4993-a66f-420c08f1471c'::uuid) )
  with check ( (select auth.uid()) in (
    '25466146-c512-4497-8ee8-88cbf3b1d22d'::uuid,
    '6554181a-e2ed-4993-a66f-420c08f1471c'::uuid) );
