-- Rosters move from Reference to the Personnel tab, gang dossiers to the Gangs
-- tab. New folders 'Personnel' and 'Gang Intel' join SOPs/Resources as
-- command-write-only so relocating the documents does not loosen who can edit.
-- (Applied live 2026-07-06 via MCP apply_migration.)
alter policy documents_ins on public.documents
  with check (private.is_active() and (folder not in ('SOPs','Resources','Personnel','Gang Intel') or (select private.is_command())));
alter policy documents_upd on public.documents
  using (private.is_active() and (folder not in ('SOPs','Resources','Personnel','Gang Intel') or (select private.is_command())))
  with check (private.is_active() and (folder not in ('SOPs','Resources','Personnel','Gang Intel') or (select private.is_command())));

update public.documents set folder = 'Personnel'  where folder = 'Resources' and name in ('CID Roster','Special Ops Roster');
update public.documents set folder = 'Gang Intel' where folder = 'Resources' and name in ('73rd Saints','Gang Fact Sheet');
