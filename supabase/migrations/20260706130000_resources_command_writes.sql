-- Reference library write-lock: extend the SOPs folder guard to 'Resources'
-- (rosters, fact sheets — command-maintained reference). Reads stay open to
-- all active members; every other folder keeps any-active-member writes.
drop policy if exists documents_ins on public.documents;
create policy documents_ins on public.documents for insert to authenticated
  with check (private.is_active() and (folder not in ('SOPs','Resources') or (select private.is_command())));
drop policy if exists documents_upd on public.documents;
create policy documents_upd on public.documents for update to authenticated
  using (private.is_active() and (folder not in ('SOPs','Resources') or (select private.is_command())))
  with check (private.is_active() and (folder not in ('SOPs','Resources') or (select private.is_command())));
