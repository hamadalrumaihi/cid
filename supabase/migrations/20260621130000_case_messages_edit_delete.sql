-- ============================================================================
-- Case chat: allow editing & deleting messages (and removing mention/link chips,
-- which are updates). case_messages previously had only select/insert policies,
-- so RLS denied all updates/deletes.
--
-- Authors may edit/delete their own messages; command (bureau_lead/deputy/director)
-- may also edit/delete for moderation. Both still require access to the case.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_policies where tablename='case_messages' and policyname='cm_upd') then
    create policy cm_upd on public.case_messages for update to authenticated
      using ( (author_id = (select auth.uid()) or (select private.is_command())) and (select private.can_access_case(case_id)) )
      with check ( (author_id = (select auth.uid()) or (select private.is_command())) and (select private.can_access_case(case_id)) );
  end if;
  if not exists (select 1 from pg_policies where tablename='case_messages' and policyname='cm_del') then
    create policy cm_del on public.case_messages for delete to authenticated
      using ( (author_id = (select auth.uid()) or (select private.is_command())) and (select private.can_access_case(case_id)) );
  end if;
end $$;
