-- ─────────────────────────────────────────────────────────────────────────────
-- Case media becomes canonical; evidence/custody_chain freeze as read-only
-- legacy.
--
-- The case "Evidence" tab is being replaced by "Photos & Media" backed by the
-- canonical public.media table (UI phase follows this migration). Production
-- reality (classified 2026-07-17): public.evidence holds exactly 3 rows — all
-- external medal.tv video links embedded in free text — and custody_chain has
-- never held a row. Real-world practice already stores case evidence in media
-- (e.g. SAB-9000018's Ev_010-A…T fivemanage screenshots are media rows).
--
-- This migration:
--   1. extends media with typed FKs (report_id, vehicle_id) and gallery
--      metadata (category, featured, archived_at) — all nullable/defaulted;
--   2. migrates the 2 evidence-only clips into media (guarded + idempotent)
--      and categorizes the 1 pre-existing media twin;
--   3. revokes client writes on evidence + custody_chain (SELECT unchanged) —
--      the 3 legacy rows are preserved, frozen, and still readable.
--
-- ── RLS access-safety analysis (no policy is created, dropped, or altered) ───
-- media policies as of 20260804010000_narcotic_sales (verbatim):
--   media_ins: for insert to authenticated
--     with check (private.is_active());
--   media_sel: for select to authenticated
--     using (private.is_active() and (not restricted or private.can_edit_narcotics_intel()));
--   media_upd: for update to authenticated
--     using (private.is_active() and (not restricted or private.can_edit_narcotics_intel()))
--     with check (private.is_active() and (not restricted or private.can_edit_narcotics_intel()));
--   media_del: for delete to authenticated
--     using (private.can_delete());
-- No media policy predicate references any FK column, so adding report_id /
-- vehicle_id changes NOTHING about visibility: the audience stays
-- is_active()-wide with the restricted gate intact. PostgREST embeds through
-- the new FKs still evaluate reports/vehicles under their own RLS. Media
-- writes remain direct-under-RLS (no RPC conversion in this pass). NOTE
-- (pre-existing, unchanged): media_upd is broad — any active member may edit
-- any non-restricted media row, which now includes category/featured/
-- archived_at. Archive semantics: archived_at hides a row from default
-- gallery views client-side only; the row, its URL and its RLS audience are
-- untouched, and restoring is `archived_at = null`. Archive never deletes the
-- file/URL.
--
-- Evidence-freeze safety: NO function or trigger in the repo writes
-- public.evidence or public.custody_chain (grep: zero `insert into` hits).
-- rls_test_cleanup() DELETEs both, but it is SECURITY DEFINER and runs with
-- owner privileges — unaffected by client-role revokes. The permanent-deletion
-- refmap only counts rows; ON DELETE CASCADE from cases fires as internal
-- referential triggers, also unaffected. service_role grants are untouched.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. media: typed FKs + gallery metadata ───────────────────────────────────
alter table public.media add column if not exists report_id uuid references public.reports(id) on delete set null;
alter table public.media add column if not exists vehicle_id uuid references public.vehicles(id) on delete set null;
alter table public.media add column if not exists category text;
alter table public.media add column if not exists featured boolean not null default false;
alter table public.media add column if not exists archived_at timestamptz;

-- null category renders as uncategorized ("All") — deliberately allowed.
alter table public.media drop constraint if exists media_category_check;
alter table public.media add constraint media_category_check
  check (category is null or category = any (array[
    'scene', 'people', 'vehicles', 'places',
    'surveillance', 'documents', 'report_media', 'other']));

-- FK indexes (house convention: an index on every FK) + the default gallery
-- query path (case media filtered on archived_at is null / not null).
create index if not exists media_report_id_fkey_idx on public.media (report_id);
create index if not exists media_vehicle_id_fkey_idx on public.media (vehicle_id);
create index if not exists media_case_id_archived_at_idx on public.media (case_id, archived_at);

-- ── 2. Data migration: the 2 evidence-only clips → media ─────────────────────
-- Production classification (2026-07-17): evidence 45ce4c71-…f301 (Ev-003) and
-- 31803cfd-…6610 (Ev-004), both SAB-9000018, carry medal.tv clips
-- mJtoIcmMSrKz and mJtHojLXXxEZXLe2K ONLY inside evidence.notes — no media
-- row exists for either. The URL is extracted from notes at apply time and
-- validated against the hardcoded clip id (the classification records clip
-- ids + uuid prefix/suffix, not full URLs — extraction keeps the value
-- verbatim from the row itself). Guards:
--   * row matched by uuid prefix AND suffix AND clip-id-in-notes;
--   * insert skipped when a media row with the same (case_id, external_url)
--     already exists — re-runs are no-ops;
--   * on a fresh rebuild without the legacy rows the whole block no-ops.
-- Remaining evidence context (id, item_code, collected_by/at, location,
-- notes) is preserved in media.tags (media has no description/notes column):
-- tags.location + tags.labels follow the MediaView conventions and
-- tags.legacy_evidence keeps the full provenance. created_at is copied from
-- the evidence row (media has no insert guard trigger; media_touch is
-- BEFORE UPDATE only), uploaded_by = evidence.collected_by.
do $mig$
declare
  src record;
  v_url text;
  v_title text;
begin
  for src in
    select e.id as eid, e.case_id, e.item_code, e.description, e.collected_by,
           e.collected_at, e.location, e.notes, e.created_at, x.clip
      from (values
        ('45ce4c71', 'f301', 'mJtoIcmMSrKz'),
        ('31803cfd', 'f610', 'mJtHojLXXxEZXLe2K')
      ) as x(id_prefix, id_suffix, clip)
      join public.evidence e
        on e.id::text like x.id_prefix || '-%'
       and e.id::text like '%' || x.id_suffix
       and position(x.clip in coalesce(e.notes, '')) > 0
  loop
    -- first medal.tv URL in notes, trailing prose punctuation trimmed
    v_url := rtrim(substring(coalesce(src.notes, '') from 'https?://\S*medal\.tv\S*'), '.,);]');
    if v_url is null or position(src.clip in v_url) = 0 then
      raise notice 'case_media_canonical: evidence % — clip % not extractable from notes; skipped', src.eid, src.clip;
      continue;
    end if;

    v_title := coalesce(
      nullif(btrim(concat_ws(' — ',
        nullif(btrim(coalesce(src.item_code, '')), ''),
        nullif(btrim(coalesce(src.description, '')), ''))), ''),
      'Legacy evidence clip');

    insert into public.media (title, type, external_url, case_id, category, uploaded_by, created_at, tags)
    select v_title,
           'video'::public.media_type,
           v_url,
           src.case_id,
           'scene',
           src.collected_by,
           src.created_at,
           jsonb_strip_nulls(jsonb_build_object(
             'location', src.location,
             'labels', to_jsonb(array_remove(array[nullif(btrim(coalesce(src.item_code, '')), '')], null)),
             'legacy_evidence', jsonb_strip_nulls(jsonb_build_object(
               'evidence_id', src.eid,
               'item_code', src.item_code,
               'collected_by', src.collected_by,
               'collected_at', src.collected_at,
               'location', src.location,
               'notes', src.notes))))
     where not exists (
             select 1 from public.media m
              where m.case_id is not distinct from src.case_id
                and m.external_url = v_url);
  end loop;

  -- Evidence d805ad95-…c2cd (SAB-9000011, clip n6RI5e8VFqPxEJ1fe) already has
  -- an exact media twin — ff5f809e ("DMC misuse of firearms attempted murder
  -- X2"). No insert; just categorize it if still uncategorized.
  update public.media
     set category = 'scene'
   where id = 'ff5f809e-fa17-4dfc-a427-6acd57b8b070'::uuid
     and category is null;
end $mig$;

-- The 3 evidence rows are NOT deleted or modified — they stay as read-only
-- legacy records behind the unchanged evidence_sel policy.

-- ── 3. evidence + custody_chain become read-only legacy ──────────────────────
-- Client write privileges are revoked (privilege check precedes RLS, so the
-- existing evidence_ins/evidence_upd/evidence_del and custody_ins policies
-- become unreachable dead letters — deliberately left in place: policy
-- semantics are unchanged, only grants move). SELECT / REFERENCES / TRIGGER
-- and all service_role grants are untouched; realtime SELECT keeps working.
revoke insert, update, delete, truncate on table public.evidence from anon, authenticated;
revoke insert, update, delete, truncate on table public.custody_chain from anon, authenticated;

-- ── Rollback reference (manual) ──────────────────────────────────────────────
--   grant insert, update, delete, truncate on table public.evidence to anon, authenticated;
--   grant insert, update, delete, truncate on table public.custody_chain to anon, authenticated;
--   delete from public.media where tags ? 'legacy_evidence';
--   drop index if exists media_case_id_archived_at_idx;
--   drop index if exists media_vehicle_id_fkey_idx;
--   drop index if exists media_report_id_fkey_idx;
--   alter table public.media drop constraint if exists media_category_check;
--   alter table public.media drop column if exists archived_at;
--   alter table public.media drop column if exists featured;
--   alter table public.media drop column if exists category;
--   alter table public.media drop column if exists vehicle_id;
--   alter table public.media drop column if exists report_id;
