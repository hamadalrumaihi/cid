-- SOPs folder write-lock (Reference tab).
-- Standard Operating Procedures live in documents(folder='SOPs'). Reading stays
-- open to every active member; creating/editing SOPs is command staff only.
-- Other folders keep their existing any-active-member write behavior (case
-- seeding copies the Forms folder and must keep working).
drop policy if exists documents_ins on public.documents;
create policy documents_ins on public.documents for insert to authenticated
  with check (private.is_active() and (folder is distinct from 'SOPs' or (select private.is_command())));
drop policy if exists documents_upd on public.documents;
create policy documents_upd on public.documents for update to authenticated
  using (private.is_active() and (folder is distinct from 'SOPs' or (select private.is_command())))
  with check (private.is_active() and (folder is distinct from 'SOPs' or (select private.is_command())));
