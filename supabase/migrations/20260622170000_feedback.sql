-- ============================================================================
-- Private owner-only feedback list (feature ideas + bug reports). Surfaced as a
-- nav tab that only the app owner sees. RLS restricts ALL access to the owner's
-- uid, so no other signed-in member can read or write it.
-- ============================================================================

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'feature' check (kind in ('feature', 'bug')),
  title text not null,
  details text,
  status text not null default 'open' check (status in ('open', 'done', 'wontfix')),
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.feedback enable row level security;

-- Owner-only: full access for the app owner (Tom Wood), no access for anyone else.
create policy feedback_owner_all on public.feedback
  for all to authenticated
  using ( (select auth.uid()) = '25466146-c512-4497-8ee8-88cbf3b1d22d'::uuid )
  with check ( (select auth.uid()) = '25466146-c512-4497-8ee8-88cbf3b1d22d'::uuid );
