-- ============================================================================
-- Case ↔ intel links. A first-class many-to-many association so a person, gang,
-- or place can be attached directly to a case ("persons/gangs/places of interest"),
-- independent of the indirect links that already exist (gang_members.case_id,
-- media.person_id, places.case_id, ballistic_footprints.case_id, …).
--
-- Polymorphic by design: kind ∈ {person, gang, place} + ref_id points at the
-- matching table. No per-kind FK (the ref is polymorphic); the client resolves
-- ref_id against its caches and skips any row whose target was since deleted, so
-- a dangling link degrades to "—" rather than erroring.
--
-- RLS mirrors the bureau-isolation model used by every other casework child:
-- select / insert / delete are all gated on private.can_access_case(case_id)
-- (which itself requires private.is_active()). Linking/unlinking is normal
-- casework, so it is available to anyone who can work the case — not command-only.
-- No UPDATE policy: a link is immutable; re-target by unlink + relink.
-- ============================================================================

create table if not exists public.case_intel_links (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases on delete cascade,
  kind text not null check (kind in ('person', 'gang', 'place')),
  ref_id uuid not null,
  role text,
  note text,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  unique (case_id, kind, ref_id)
);

-- Covers the FK + the "what's linked to this case" query, and the reverse
-- "which cases is this intel item linked to" lookup (kind, ref_id).
create index if not exists case_intel_links_case_idx
  on public.case_intel_links (case_id);
create index if not exists case_intel_links_ref_idx
  on public.case_intel_links (kind, ref_id);

alter table public.case_intel_links enable row level security;

create policy case_intel_links_sel on public.case_intel_links
  for select to authenticated using ( private.can_access_case(case_id) );
create policy case_intel_links_ins on public.case_intel_links
  for insert to authenticated with check ( private.can_access_case(case_id) );
create policy case_intel_links_del on public.case_intel_links
  for delete to authenticated using ( private.can_access_case(case_id) );
