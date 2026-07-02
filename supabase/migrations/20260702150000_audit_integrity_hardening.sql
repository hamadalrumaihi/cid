-- Deep-audit integrity hardening (Wave 5)
-- Two client-only integrity controls were found to be unenforced server-side.
-- This migration moves both into Postgres so the UI can no longer be bypassed
-- via the raw PostgREST API.

-- 1) FINALIZED REPORTS ARE NOW TRULY SEALED ---------------------------------
-- Previously the block trigger only protected the `finalized`/`signature`
-- columns, so any member with case access could rewrite a signed report's
-- `fields` (narrative, probable cause, suspects) while it still displayed as
-- electronically signed. We now also reject post-finalize edits to `fields`,
-- whitelisting ONLY the warrant-lifecycle keys the client legitimately patches
-- on a finalized warrant (_warrant_status / _warrant_log). Report finalization
-- itself still flows through report_finalize() (SECURITY DEFINER), which runs
-- as the function owner and is unaffected by the current_user guard below.
create or replace function private.block_direct_report_finalize()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
  if current_user in ('authenticated','anon') then
    if new.finalized is distinct from old.finalized
       or new.signature is distinct from old.signature then
      raise exception 'reports can only be finalized via report_finalize()';
    end if;
    -- Once finalized, the body is locked under the signing officer's signature.
    if old.finalized and (
         (coalesce(new.fields, '{}'::jsonb) - '_warrant_status' - '_warrant_log')
         is distinct from
         (coalesce(old.fields, '{}'::jsonb) - '_warrant_status' - '_warrant_log')) then
      raise exception 'a finalized report''s contents are locked (only the warrant lifecycle may change)';
    end if;
  end if;
  return new;
end $function$;

-- 2) GPS TRACKER DUAL-SIGNATURE IS NOW ENFORCED SERVER-SIDE ------------------
-- The dual-command-signature control (SOP Title 7) was gated only in the
-- browser; RLS allowed any active member to insert/authorize/forge a tracker.
-- Restrict writes to command staff (the only roles the UI ever lets create or
-- co-sign) and add a trigger forbidding a single person from filling both
-- signature slots. SELECT is left unchanged so detectives can still view.
drop policy if exists trackers_ins on public.trackers;
create policy trackers_ins on public.trackers for insert to authenticated
  with check (private.can_delete());

drop policy if exists trackers_upd on public.trackers;
create policy trackers_upd on public.trackers for update to authenticated
  using (private.can_delete()) with check (private.can_delete());

create or replace function private.block_tracker_self_cosign()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
  if new.director_sig is not null and new.deputy_sig is not null
     and new.director_sig = new.deputy_sig then
    raise exception 'a tracker requires two distinct command signatures';
  end if;
  return new;
end $function$;

drop trigger if exists trg_block_tracker_self_cosign on public.trackers;
create trigger trg_block_tracker_self_cosign
  before insert or update on public.trackers
  for each row execute function private.block_tracker_self_cosign();
