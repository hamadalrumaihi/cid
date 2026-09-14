-- ============================================================================
-- 20261110120000_association_realtime.sql
-- Entity associations join the realtime publication.
--
-- Additive and publication-only: no table, column, policy, grant, RPC or row
-- changes here, and nothing is dropped. The single effect is that changes to
-- public.entity_associations reach subscribers.
--
-- WHY. An association is REVIEWED work, and the review is shared: one member
-- records an observation, another rules on it, a third amends it. Until now
-- `entity_associations` was outside the publication, so a dossier open on a
-- second screen kept the snapshot it read when the section mounted — an
-- investigator could confirm an association while a colleague went on reading
-- it as "Pending Investigation", or record one nobody else saw until they
-- reloaded. Every supported change is carried by this publication: a creation
-- is an INSERT, and a decision, an amendment, an archival (`historical`) and
-- a soft delete are all UPDATEs on the same row.
--
-- WHAT IT DOES NOT CHANGE — the part that matters. Realtime is a DOORBELL,
-- not a key. `entity_associations_sel` (20261106120000) is untouched and
-- remains the wall: a row is visible only when BOTH endpoints are visible to
-- the caller, so the SIU wall cannot be walked around through a link. The
-- client deliberately never reads an event payload either: a change bumps a
-- counter and the section RE-READS through `entity_associations_for`, which
-- is SECURITY INVOKER, so what anyone sees after an event is exactly what
-- they could have seen before it — no more, and freshly.
--
-- Replica identity is deliberately left at DEFAULT. The filtered channels
-- match on the NEW row, which covers INSERT and UPDATE — and every status
-- change, including archival and soft deletion, is an UPDATE. Only a
-- permanent deletion is a DELETE, and forcing REPLICA IDENTITY FULL on the
-- whole table to carry old values for that one case would put every column of
-- every update into the WAL for no reader that needs it.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'entity_associations'
  ) then
    alter publication supabase_realtime add table public.entity_associations;
  end if;
end $$;
