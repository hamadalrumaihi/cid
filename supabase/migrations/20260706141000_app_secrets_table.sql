-- Reproducible app_secrets backing table for server-side jobs.
--
-- Edge Functions using the service role read this table for deployment-time
-- configuration (for example sops-sync). App users must never read or write it:
-- RLS is enabled with no authenticated/anon policies, and API grants are revoked
-- from public web roles. The service_role key bypasses RLS server-side.

create table if not exists public.app_secrets (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_secrets enable row level security;

drop policy if exists app_secrets_no_anon_select on public.app_secrets;
drop policy if exists app_secrets_no_anon_write on public.app_secrets;

revoke all on table public.app_secrets from anon, authenticated;
grant all on table public.app_secrets to service_role;

create or replace function private.touch_app_secrets()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists app_secrets_touch on public.app_secrets;
create trigger app_secrets_touch
  before update on public.app_secrets
  for each row execute function private.touch_app_secrets();
