-- ============================================================================
-- ODYSSEY CID PORTAL — Storage buckets + RLS (path-encoded bureau prefix)
-- Convention: object name = '{BUREAU}/{entity_id}/{uuid.ext}', BUREAU ∈ LSB|BCB|SAB|JTF
-- Evidence is gated by the same can_view_bureau() rule as the data; mugshots are
-- readable by any active member (gang data is global) but command-managed.
-- ============================================================================

insert into storage.buckets (id, name, public) values
  ('evidence', 'evidence', false),
  ('mugshots', 'mugshots', false),
  ('backups',  'backups',  false)
on conflict (id) do nothing;

-- Safe path → bureau parser (returns null on malformed prefix instead of casting error).
create or replace function public.path_bureau(p text)
returns public.bureau language plpgsql immutable set search_path = '' as $$
declare seg text;
begin
  seg := split_part(p, '/', 1);
  if seg in ('LSB','BCB','SAB','JTF') then return seg::public.bureau; end if;
  return null;
end $$;

-- ---------- evidence bucket ----------
create policy evidence_read on storage.objects for select to authenticated
  using ( bucket_id = 'evidence'
          and public.path_bureau(name) is not null
          and public.can_view_bureau(public.path_bureau(name)) );
create policy evidence_write on storage.objects for insert to authenticated
  with check ( bucket_id = 'evidence'
               and public.path_bureau(name) is not null
               and public.can_write_bureau(public.path_bureau(name)) );
create policy evidence_update on storage.objects for update to authenticated
  using ( bucket_id = 'evidence' and public.can_write_bureau(public.path_bureau(name)) );
create policy evidence_delete on storage.objects for delete to authenticated
  using ( bucket_id = 'evidence' and public.is_command(public.path_bureau(name)) );

-- ---------- mugshots bucket (global read for active members; command write) ----------
create policy mugshots_read on storage.objects for select to authenticated
  using ( bucket_id = 'mugshots' and public.is_active() );
create policy mugshots_write on storage.objects for insert to authenticated
  with check ( bucket_id = 'mugshots' and public.is_command() );
create policy mugshots_update on storage.objects for update to authenticated
  using ( bucket_id = 'mugshots' and public.is_command() );
create policy mugshots_delete on storage.objects for delete to authenticated
  using ( bucket_id = 'mugshots' and public.is_command() );

-- ---------- backups bucket (command only) ----------
create policy backups_all on storage.objects for all to authenticated
  using ( bucket_id = 'backups' and public.is_command() )
  with check ( bucket_id = 'backups' and public.is_command() );
