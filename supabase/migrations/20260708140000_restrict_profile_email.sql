-- S3 (audit): member sign-in emails were readable by any active member via the
-- profiles REST endpoint (profiles_sel exposes every active member's row, all
-- columns). Restrict the `email` column to command.
--
-- A column-level REVOKE alone does nothing while a table-level SELECT grant
-- exists, so we remove the table grant and re-grant SELECT on every column
-- except email. RLS still applies on top. Client reads use the non-email columns;
-- a member's own email comes from the auth session; the command member-admin
-- panel reads addresses through the command-gated admin_member_emails() RPC.
revoke select on public.profiles from authenticated;
grant select (id, display_name, avatar_url, badge_number, division, role,
              active, created_at, updated_at, loa, loa_since, discord_id)
  on public.profiles to authenticated;
-- NOTE: column-level grants do not extend to columns added later. The removed_at
-- column (added in 20260708150000) is granted in that migration.

create or replace function public.admin_member_emails()
returns table(id uuid, email text)
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not private.is_command() then raise exception 'not authorized'; end if;
  return query select p.id, p.email from public.profiles p;
end $$;

grant execute on function public.admin_member_emails() to authenticated;
