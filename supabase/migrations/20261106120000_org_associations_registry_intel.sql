-- ============================================================================
-- 20261106120000_org_associations_registry_intel.sql
-- Organization associations and registry intelligence attachments.
--
-- Two gaps this closes, both required by the Gang & Organization Registry
-- intake of 2026-09-11:
--   1. The registry could relate a person to a person (person_relationships)
--      and a gang to a block (gang_turf), but NOT one organization to another,
--      and not an organization to a property except through
--      places.controlling_gang_id — a single-valued CONTROL claim, which is
--      the wrong statement to make when all that was observed is two
--      organizations' branding on one property. public.entity_associations is
--      the general, reviewable link: subject -> object, an association verb, a
--      workflow status that starts at 'pending_investigation', and a decision
--      trail. Nothing here ever implies alliance, merger or control unless an
--      investigator says so explicitly.
--   2. A screenshot could only be stored against a CASE (the case-evidence
--      bucket path is case/<case_id>/<media_id>/...). Registry intelligence has
--      no case, so the same private bucket now also accepts
--      registry/<kind>/<entity_id>/<media_id>/<file>, gated by the registry
--      visibility wall. These are intelligence attachments, NOT case evidence:
--      they do not enter the EV- series, the custody ledger or the integrity
--      sweep, and the media integrity columns stay service-only as before.
--
-- APPLICATION NOTE: applied live to project jhxuflzmqspidkvjckox in FIVE
-- consecutive parts (Supabase MCP), in this order and under these names —
-- each part is delimited below by `-- ===== PART n: <name> =====`:
--   1. org_associations_core       (the table, indexes, RLS, the four RPCs)
--   2. org_registry_media          (the registry/ storage path on case-evidence
--      and public.registry_media_attach)
--   3. org_associations_plumbing   (soft delete / Trash / dispatch / catalog,
--      every function re-emitted WHOLE from its live text with the existing
--      arms byte-identical and only the new arm added)
--   4. org_associations_rls_test_cleanup (the fixture sweep, spliced)
--   5. org_associations_review_fixes  (verification follow-up: an
--      association may not name a record that does not exist; every
--      vocabulary and date is refused as {ok:false} rather than 23514 /
--      22007; a photograph of a RESTRICTED narcotic is restricted itself)
--
-- NOTE ON PART 3's private.perm_dispatch: it is re-emitted from the PART 6
-- text of 20261105120000_platform_upgrade.sql, NOT from supabase/schema-snapshot.sql.
-- The snapshot committed with that phase carried the PART 5 body (the packet
-- read/download guard and the case/<case_id>/<media_id>/ document binding were
-- missing), so building on it would have silently reverted that security fix.
-- The snapshot is rebuilt from a fresh live dump with this migration.
-- ============================================================================

-- ===== PART 1: org_associations_core =====

-- ---------------------------------------------------------------------------
-- 1.1 public.entity_associations
-- ---------------------------------------------------------------------------
-- A reviewable link between two registry records. The pair is stored
-- canonically for same-kind subjects (LEAST/GREATEST on the ids) so
-- "A associated with B" and "B associated with A" are one row, not two.
--
-- status is the workflow, association is the claim:
--   pending_investigation -> an investigator has not ruled on it yet
--   confirmed / rejected  -> someone decided, and decided_by/at/note say who
--   historical            -> it was true and no longer is
-- An observation never writes 'confirmed' on its own.
create table if not exists public.entity_associations (
  id uuid primary key default gen_random_uuid(),
  subject_kind text not null check (subject_kind in ('gang', 'person', 'place', 'vehicle', 'narcotic', 'account', 'indicator')),
  subject_id uuid not null,
  object_kind text not null check (object_kind in ('gang', 'person', 'place', 'vehicle', 'narcotic', 'account', 'indicator')),
  object_id uuid not null,
  -- The claim. 'unconfirmed_association' is the deliberate default for a
  -- co-location or co-branding observation: it asserts a link and nothing
  -- about its nature. 'observed_at' / 'operates_from' / 'controls' are the
  -- three property claims, in ascending order of strength.
  association text not null check (association in (
    'unconfirmed_association', 'alliance', 'rivalry', 'conflict',
    'shared_property', 'business_relationship', 'supplier', 'subsidiary',
    'splinter', 'successor', 'observed_at', 'operates_from', 'controls', 'other')),
  status text not null default 'pending_investigation'
    check (status in ('pending_investigation', 'confirmed', 'rejected', 'historical')),
  confidence text check (confidence is null or confidence in ('confirmed', 'probable', 'possible', 'unverified', 'disproven')),
  source_type text check (source_type is null or source_type in (
    'visual_intelligence', 'field_observation', 'informant', 'surveillance',
    'document', 'digital', 'interview', 'open_source', 'other')),
  note text,
  first_observed date,
  last_confirmed date,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  delete_reason text,
  delete_batch uuid,
  constraint entity_associations_not_self check (not (subject_kind = object_kind and subject_id = object_id))
);

-- One live row per (pair, association). Same-kind pairs are canonicalised so
-- the direction a submitter happened to pick cannot create a duplicate.
create unique index if not exists entity_associations_pair_key on public.entity_associations (
  subject_kind, object_kind,
  (case when subject_kind = object_kind then least(subject_id, object_id) else subject_id end),
  (case when subject_kind = object_kind then greatest(subject_id, object_id) else object_id end),
  association
) where deleted_at is null;
create index if not exists entity_associations_subject_idx on public.entity_associations (subject_kind, subject_id) where deleted_at is null;
create index if not exists entity_associations_object_idx on public.entity_associations (object_kind, object_id) where deleted_at is null;
create index if not exists entity_associations_status_idx on public.entity_associations (status) where deleted_at is null;
create index if not exists entity_associations_created_by_idx on public.entity_associations (created_by);
create index if not exists entity_associations_decided_by_idx on public.entity_associations (decided_by);
create index if not exists entity_associations_deleted_at_idx on public.entity_associations (deleted_at) where deleted_at is not null;
create index if not exists entity_associations_delete_batch_idx on public.entity_associations (delete_batch) where delete_batch is not null;

alter table public.entity_associations enable row level security;
revoke all on public.entity_associations from public, anon, authenticated;
grant select on public.entity_associations to authenticated;
grant all on public.entity_associations to service_role;

-- Read follows BOTH endpoints: an association is only visible to someone who
-- may see each record it names. That keeps the SIU wall intact — a link can
-- never be the thing that reveals a hidden record.
drop policy if exists entity_associations_sel on public.entity_associations;
create policy entity_associations_sel on public.entity_associations
  as permissive for select to authenticated
  using (
    (private.is_live(deleted_at) or private.is_owner())
    and private.is_active()
    and private.perm_registry_visible(subject_kind, subject_id)
    and private.perm_registry_visible(object_kind, object_id)
  );
-- No client INSERT / UPDATE / DELETE: every write is one of the RPCs below.

-- House triggers for a soft-deletable registry child (person_relationships shape):
-- touch updated_at, audit every row change with its detail, and refuse a
-- deleted_at written by anything but public.soft_delete.
drop trigger if exists entity_associations_touch on public.entity_associations;
create trigger entity_associations_touch before update on public.entity_associations
  for each row execute function private.touch();
drop trigger if exists entity_associations_audit on public.entity_associations;
create trigger entity_associations_audit after insert or update or delete on public.entity_associations
  for each row execute function private.audit_detail();
drop trigger if exists entity_associations_block_direct_soft_delete on public.entity_associations;
create trigger entity_associations_block_direct_soft_delete before insert or update on public.entity_associations
  for each row execute function private.block_direct_soft_delete();

-- ---------------------------------------------------------------------------
-- 1.2 helpers
-- ---------------------------------------------------------------------------
-- Purpose:        the display label of a registry record, for audit detail and
--                 Trash labels. Never raises; null when not visible.
create or replace function private.registry_label(p_kind text, p_id uuid)
returns text language plpgsql stable security definer set search_path to '' as $$
declare v text;
begin
  if p_id is null or not private.perm_registry_visible(p_kind, p_id) then return null; end if;
  case p_kind
    when 'gang'      then select g.name into v from public.gangs g where g.id = p_id;
    when 'person'    then select p.name into v from public.persons p where p.id = p_id;
    when 'place'     then select pl.name into v from public.places pl where pl.id = p_id;
    when 'vehicle'   then select coalesce(vh.plate, vh.model) into v from public.vehicles vh where vh.id = p_id;
    when 'narcotic'  then select n.name into v from public.narcotics n where n.id = p_id;
    when 'account'   then select a.handle into v from public.accounts a where a.id = p_id;
    when 'indicator' then select i.value into v from public.indicators i where i.id = p_id;
    else v := null;
  end case;
  return v;
end $$;
revoke all on function private.registry_label(text, uuid) from public, anon, authenticated;
-- ...but public.entity_associations_for is SECURITY INVOKER on purpose (the RLS
-- policy is the wall), and an INVOKER function runs as the caller, so the caller
-- must be able to execute this helper. That is the same grant
-- private.perm_registry_visible, private.can_read_case and private.siu_blocked
-- already carry, for exactly this reason. The helper is itself SECURITY DEFINER
-- and returns null for anything the caller may not see, so the grant adds no reach.
grant execute on function private.registry_label(text, uuid) to authenticated;

-- Purpose:        the association row a member may act on, or a refusal that
--                 says the same thing for "not yours" and "does not exist".
create or replace function private.association_for(p_action text, p_id uuid)
returns public.entity_associations language plpgsql stable security definer set search_path to '' as $$
declare a public.entity_associations;
begin
  select * into a from public.entity_associations where id = p_id and deleted_at is null;
  if not found or not private.is_active()
     or not private.perm_registry_visible(a.subject_kind, a.subject_id)
     or not private.perm_registry_visible(a.object_kind, a.object_id) then
    perform private.perm_raise(p_action, 'entity_association', p_id, 'not_found', 'association not found');
  end if;
  return a;
end $$;
revoke all on function private.association_for(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1.3 public RPCs
-- ---------------------------------------------------------------------------
-- Purpose:        record an association between two registry records. Always
--                 lands on the caller's claim with status
--                 'pending_investigation' unless the caller is command and
--                 says otherwise — an observation is not a finding.
-- Authorization:  active, and BOTH records visible; P0403 otherwise.
-- Side effects:   entity_associations row, audit ENTITY_ASSOCIATION_CREATED.
create or replace function public.entity_association_create(
  p_subject_kind text, p_subject_id uuid, p_object_kind text, p_object_id uuid,
  p_association text, p_note text default null, p_confidence text default null,
  p_source_type text default null, p_first_observed date default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); v_id uuid; v_existing public.entity_associations;
        v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_uid is null or not private.is_active() then
    perform private.perm_raise('create', 'entity_association', null, 'denied', 'not an active member');
  end if;
  if not private.perm_registry_visible(p_subject_kind, p_subject_id)
     or not private.perm_registry_visible(p_object_kind, p_object_id) then
    perform private.perm_raise('create', 'entity_association', p_subject_id, 'not_found', 'record not found');
  end if;
  if p_subject_kind = p_object_kind and p_subject_id = p_object_id then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'a record cannot be associated with itself');
  end if;

  -- An existing live row for the same pair + claim is returned, never
  -- duplicated and never silently overwritten (intake rule: append, do not
  -- overwrite). The caller is told which it got.
  select * into v_existing from public.entity_associations
   where deleted_at is null and association = p_association
     and ((subject_kind = p_subject_kind and subject_id = p_subject_id and object_kind = p_object_kind and object_id = p_object_id)
          or (p_subject_kind = p_object_kind and subject_kind = p_object_kind and subject_id = p_object_id and object_kind = p_subject_kind and object_id = p_subject_id))
   limit 1;
  if found then
    return jsonb_build_object('ok', true, 'id', v_existing.id, 'created', false, 'status', v_existing.status,
                              'message', 'this association is already recorded');
  end if;

  insert into public.entity_associations (
    subject_kind, subject_id, object_kind, object_id, association, status,
    confidence, source_type, note, first_observed, created_by)
  values (p_subject_kind, p_subject_id, p_object_kind, p_object_id, p_association, 'pending_investigation',
          p_confidence, p_source_type, v_note, p_first_observed, v_uid)
  returning id into v_id;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'ENTITY_ASSOCIATION_CREATED', 'entity_associations', v_id,
          jsonb_build_object('subject_kind', p_subject_kind, 'subject_id', p_subject_id,
                             'object_kind', p_object_kind, 'object_id', p_object_id,
                             'association', p_association, 'status', 'pending_investigation',
                             'subject_label', private.registry_label(p_subject_kind, p_subject_id),
                             'object_label', private.registry_label(p_object_kind, p_object_id)));
  return jsonb_build_object('ok', true, 'id', v_id, 'created', true, 'status', 'pending_investigation');
end $$;
revoke all on function public.entity_association_create(text, uuid, text, uuid, text, text, text, text, date) from public, anon;
grant execute on function public.entity_association_create(text, uuid, text, uuid, text, text, text, text, date) to authenticated, service_role;

-- Purpose:        an investigator rules on an association: confirm, reject, or
--                 mark it historical. The claim itself may be corrected at the
--                 same time (an "unconfirmed association" that turns out to be
--                 a business relationship becomes one).
-- Authorization:  active + both records visible; P0403 otherwise.
-- Side effects:   status / decided_by / decided_at / decision_note, audit.
create or replace function public.entity_association_decide(
  p_id uuid, p_status text, p_note text default null,
  p_association text default null, p_confidence text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); a public.entity_associations;
        v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  a := private.association_for('decide', p_id);
  if p_status not in ('pending_investigation', 'confirmed', 'rejected', 'historical') then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown status');
  end if;
  if p_status in ('confirmed', 'rejected') and v_note is null then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'confirming or rejecting an association needs a reason');
  end if;

  update public.entity_associations
     set status = p_status,
         association = coalesce(p_association, association),
         confidence = coalesce(p_confidence, confidence),
         decision_note = v_note,
         decided_by = case when p_status = 'pending_investigation' then null else v_uid end,
         decided_at = case when p_status = 'pending_investigation' then null else now() end,
         last_confirmed = case when p_status = 'confirmed' then current_date else last_confirmed end
   where id = p_id;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'ENTITY_ASSOCIATION_DECIDED', 'entity_associations', p_id,
          jsonb_build_object('from_status', a.status, 'to_status', p_status,
                             'from_association', a.association, 'to_association', coalesce(p_association, a.association),
                             'subject_label', private.registry_label(a.subject_kind, a.subject_id),
                             'object_label', private.registry_label(a.object_kind, a.object_id)));
  return jsonb_build_object('ok', true, 'id', p_id, 'status', p_status);
end $$;
revoke all on function public.entity_association_decide(uuid, text, text, text, text) from public, anon;
grant execute on function public.entity_association_decide(uuid, text, text, text, text) to authenticated, service_role;

-- Purpose:        amend the descriptive fields of an association without ruling
--                 on it (note, confidence, source, observation dates).
-- Authorization:  the author, or command; P0403 otherwise.
create or replace function public.entity_association_update(p_id uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); a public.entity_associations; v_keys text[];
begin
  a := private.association_for('edit', p_id);
  if not (a.created_by = v_uid or private.is_command() or private.is_owner()) then
    perform private.perm_raise('edit', 'entity_association', p_id, 'denied', 'only the author or command may amend this association');
  end if;
  select array_agg(k) into v_keys from jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) k;
  if v_keys is null or not (v_keys <@ array['note', 'confidence', 'source_type', 'first_observed', 'last_confirmed']) then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'only note, confidence, source_type, first_observed and last_confirmed may be amended');
  end if;
  update public.entity_associations
     set note = case when p_patch ? 'note' then nullif(btrim(coalesce(p_patch ->> 'note', '')), '') else note end,
         confidence = case when p_patch ? 'confidence' then p_patch ->> 'confidence' else confidence end,
         source_type = case when p_patch ? 'source_type' then p_patch ->> 'source_type' else source_type end,
         first_observed = case when p_patch ? 'first_observed' then (p_patch ->> 'first_observed')::date else first_observed end,
         last_confirmed = case when p_patch ? 'last_confirmed' then (p_patch ->> 'last_confirmed')::date else last_confirmed end
   where id = p_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'ENTITY_ASSOCIATION_UPDATED', 'entity_associations', p_id, jsonb_build_object('fields', to_jsonb(v_keys)));
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;
revoke all on function public.entity_association_update(uuid, jsonb) from public, anon;
grant execute on function public.entity_association_update(uuid, jsonb) to authenticated, service_role;

-- Purpose:        every association touching one registry record, both
--                 directions, with the other side's label resolved. SECURITY
--                 INVOKER: entity_associations_sel does the wall.
create or replace function public.entity_associations_for(p_kind text, p_id uuid)
returns table (
  id uuid, direction text, other_kind text, other_id uuid, other_label text,
  association text, status text, confidence text, source_type text, note text,
  first_observed date, last_confirmed date,
  created_by uuid, created_by_name text, created_at timestamptz,
  decided_by uuid, decided_by_name text, decided_at timestamptz, decision_note text)
language sql stable security invoker set search_path to '' as $$
  select a.id,
         case when a.subject_kind = p_kind and a.subject_id = p_id then 'subject' else 'object' end,
         case when a.subject_kind = p_kind and a.subject_id = p_id then a.object_kind else a.subject_kind end,
         case when a.subject_kind = p_kind and a.subject_id = p_id then a.object_id else a.subject_id end,
         case when a.subject_kind = p_kind and a.subject_id = p_id
              then private.registry_label(a.object_kind, a.object_id)
              else private.registry_label(a.subject_kind, a.subject_id) end,
         a.association, a.status, a.confidence, a.source_type, a.note,
         a.first_observed, a.last_confirmed,
         a.created_by, cp.display_name, a.created_at,
         a.decided_by, dp.display_name, a.decided_at, a.decision_note
    from public.entity_associations a
    left join public.profiles cp on cp.id = a.created_by
    left join public.profiles dp on dp.id = a.decided_by
   where a.deleted_at is null
     and ((a.subject_kind = p_kind and a.subject_id = p_id) or (a.object_kind = p_kind and a.object_id = p_id))
   order by (a.status = 'pending_investigation') desc, a.created_at desc
$$;
revoke all on function public.entity_associations_for(text, uuid) from public, anon;
grant execute on function public.entity_associations_for(text, uuid) to authenticated, service_role;

-- ===== PART 2: org_registry_media =====

-- ---------------------------------------------------------------------------
-- 2.1 registry/<kind>/<entity_id>/<media_id>/<file> on the case-evidence bucket
-- ---------------------------------------------------------------------------
-- Registry intelligence (a photograph of a gang tag, a mural, a shopfront) had
-- nowhere private to live: `media` already carries gang_id / person_id /
-- place_id / vehicle_id / narcotic_id with a null case_id, but the only object
-- path the bucket accepted was case/<case_id>/<media_id>/..., so a registry
-- photo had to go to FiveManage and come back as a browser-visible
-- `external_url`. That is the same class of exposure the platform upgrade
-- removed for case evidence.
--
-- The registry path is the same private bucket with a second, narrower prefix.
-- It is deliberately NOT case evidence: these objects never get an EV- number,
-- never enter the custody ledger and never enter the integrity sweep. The
-- media integrity columns stay service-only (media_protect_integrity is
-- untouched).
--
-- The write policy binds the object to a media row that
--   (a) exists and is live,
--   (b) has NO case (a case object belongs under case/, not here),
--   (c) is the caller's own upload,
--   (d) already names this exact object path, and
--   (e) points at the entity named in segment 3, through the column that
--       matches the kind in segment 2,
-- so the path cannot be used to plant an object in another record's namespace
-- or to smuggle a case object past the case rules.
drop policy if exists registry_media_read on storage.objects;
create policy registry_media_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'case-evidence'
    and (storage.foldername(name))[1] = 'registry'
    and private.perm_registry_visible('media', private.uuid_or_null((storage.foldername(name))[4]))
  );

drop policy if exists registry_media_write on storage.objects;
create policy registry_media_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'case-evidence'
    and (storage.foldername(name))[1] = 'registry'
    and private.is_active()
    and private.perm_registry_visible((storage.foldername(name))[2], private.uuid_or_null((storage.foldername(name))[3]))
    and exists (
      select 1 from public.media m
       where m.id = private.uuid_or_null((storage.foldername(name))[4])
         and m.deleted_at is null
         and m.case_id is null
         and m.uploaded_by = (select auth.uid())
         and m.storage_path = name
         and case (storage.foldername(name))[2]
               when 'gang'     then m.gang_id
               when 'person'   then m.person_id
               when 'place'    then m.place_id
               when 'vehicle'  then m.vehicle_id
               when 'narcotic' then m.narcotic_id
               else null end = private.uuid_or_null((storage.foldername(name))[3]))
  );
-- As with case/, deliberately NO update and NO delete policy for authenticated:
-- an original is immutable, and only the permanent-deletion protocol (or the
-- service) removes the object.

-- ---------------------------------------------------------------------------
-- 2.2 public.registry_media_attach
-- ---------------------------------------------------------------------------
-- Purpose:        reserve a media row and the object path for a registry
--                 intelligence photograph, so the browser can upload the
--                 ORIGINAL bytes to private storage instead of a public host.
--                 The row is created first (the storage policy checks it), the
--                 caller then uploads to the returned path.
-- Authorization:  active member who can see the registry record; P0403
--                 otherwise. The record is never modified — this only adds.
-- Side effects:   media row (uploaded_by = the caller, case_id null),
--                 audit REGISTRY_MEDIA_ATTACHED (the media_audit trigger also
--                 writes its own INSERT row).
create or replace function public.registry_media_attach(
  p_kind text, p_entity_id uuid, p_title text, p_filename text,
  p_mime text default null, p_byte_size bigint default null,
  p_category text default null, p_caption text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid := gen_random_uuid();
  v_title text := left(nullif(btrim(coalesce(p_title, '')), ''), 200);
  v_caption text := nullif(btrim(coalesce(p_caption, '')), '');
  v_name text := left(regexp_replace(lower(btrim(coalesce(p_filename, ''))), '[^a-z0-9._-]+', '-', 'g'), 120);
  v_path text;
begin
  if v_uid is null or not private.is_active() then
    perform private.perm_raise('attach', 'registry_media', p_entity_id, 'denied', 'not an active member');
  end if;
  if p_kind not in ('gang', 'person', 'place', 'vehicle', 'narcotic') then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'unknown record kind');
  end if;
  if not private.perm_registry_visible(p_kind, p_entity_id) then
    perform private.perm_raise('attach', 'registry_media', p_entity_id, 'not_found', 'record not found');
  end if;
  if v_title is null then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'a title is required');
  end if;
  v_name := nullif(btrim(v_name, '-.'), '');
  if v_name is null then v_name := 'upload'; end if;
  v_path := 'registry/' || p_kind || '/' || p_entity_id::text || '/' || v_id::text || '/' || v_name;

  insert into public.media (id, title, type, storage_path, kind, category, tags,
                            gang_id, person_id, place_id, vehicle_id, narcotic_id,
                            mime, byte_size, original_filename, uploaded_by)
  values (v_id, v_title,
          case when coalesce(p_mime, '') like 'video/%' then 'video'::public.media_type
               when coalesce(p_mime, '') like 'image/%' then 'image'::public.media_type
               else 'document'::public.media_type end,
          v_path, 'registry_intel',
          case when p_category in ('scene', 'people', 'vehicles', 'places', 'surveillance', 'documents', 'other') then p_category else 'other' end,
          case when v_caption is null then '{}'::jsonb else jsonb_build_object('caption', v_caption) end,
          case when p_kind = 'gang' then p_entity_id end,
          case when p_kind = 'person' then p_entity_id end,
          case when p_kind = 'place' then p_entity_id end,
          case when p_kind = 'vehicle' then p_entity_id end,
          case when p_kind = 'narcotic' then p_entity_id end,
          nullif(btrim(coalesce(p_mime, '')), ''), p_byte_size,
          nullif(btrim(coalesce(p_filename, '')), ''), v_uid);

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'REGISTRY_MEDIA_ATTACHED', 'media', v_id,
          jsonb_build_object('kind', p_kind, 'entity_id', p_entity_id, 'title', v_title,
                             'label', private.registry_label(p_kind, p_entity_id),
                             'storage_path', v_path, 'caption', v_caption));
  return jsonb_build_object('ok', true, 'media_id', v_id, 'storage_path', v_path, 'bucket', 'case-evidence');
end $$;
revoke all on function public.registry_media_attach(text, uuid, text, text, text, bigint, text, text) from public, anon;
grant execute on function public.registry_media_attach(text, uuid, text, text, text, bigint, text, text) to authenticated, service_role;

-- ===== PART 3: org_associations_plumbing =====

-- ---------------------------------------------------------------------------
-- 3.1 two small predicates the dispatch arm needs
-- ---------------------------------------------------------------------------
-- Purpose:        is this association visible to the caller? The AND of both
--                 endpoints, exactly as entity_associations_sel says, but as a
--                 boolean rather than a refusal (private.association_for
--                 raises; perm_dispatch must never raise).
create or replace function private.assoc_visible(p_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.entity_associations a
     where a.id = p_id
       and private.is_active()
       and private.perm_registry_visible(a.subject_kind, a.subject_id)
       and private.perm_registry_visible(a.object_kind, a.object_id))
$$;
revoke all on function private.assoc_visible(uuid) from public, anon, authenticated;

-- Purpose:        may the caller amend or withdraw this association? The person
--                 who recorded the observation, or command. Ruling on it
--                 (confirm / reject) is a wider right and is not this.
create or replace function private.assoc_author_or_command(p_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select private.is_owner() or private.is_command()
      or exists (select 1 from public.entity_associations a
                  where a.id = p_id and a.created_by = (select auth.uid()) and private.is_active())
$$;
revoke all on function private.assoc_author_or_command(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3.2 soft-delete plumbing, every function re-emitted WHOLE from its live text
--     with the existing arms byte-identical and only the new arm added
--     (private.soft_delete_table, private.permanent_delete_record_label,
--      public.trash_list, private.perm_dispatch,
--      private.permanent_delete_record_apply).
--
--     private.trash_case_expr and private.soft_delete_state need no change:
--     an association has no case, and their `else 'null::uuid'` default is
--     already the right answer. public.soft_delete and public.restore_record
--     are generic over private.soft_delete_table and need no change either —
--     an association has no children to cascade and no parent row to check.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.soft_delete_table(p_kind text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case p_kind
    when 'person' then 'persons'
    when 'vehicle' then 'vehicles'
    when 'gang' then 'gangs'
    when 'place' then 'places'
    when 'account' then 'accounts'
    when 'indicator' then 'indicators'
    when 'narcotic' then 'narcotics'
    when 'operation' then 'operations'
    when 'tracker' then 'trackers'
    when 'gang_member' then 'gang_members'
    when 'gang_turf' then 'gang_turf'
    when 'person_place' then 'person_places'
    when 'person_vehicle' then 'person_vehicles'
    when 'person_relationship' then 'person_relationships'
    when 'account_link' then 'account_links'
    when 'case' then 'cases'
    when 'report' then 'reports'
    when 'media' then 'media'
    when 'evidence' then 'evidence'
    when 'case_task' then 'case_tasks'
    when 'case_message' then 'case_messages'
    when 'case_intel_link' then 'case_intel_links'
    when 'case_blocker' then 'case_blockers'
    when 'rico_case' then 'rico_cases'
    when 'predicate_act' then 'predicate_acts'
    when 'case_note' then 'case_notes'
    when 'case_link' then 'case_links'
    when 'ci' then 'confidential_informants'
    when 'ci_intelligence' then 'ci_intelligence'
    when 'ci_contact' then 'ci_contacts'
    when 'ci_payment' then 'ci_payments'
    when 'case_template' then 'case_templates'
    when 'commendation' then 'commendations'
    when 'case_packet' then 'case_packets'
    when 'external_source' then 'external_sources'
    -- NEW (20261106120000): the reviewable organization/registry link.
    when 'entity_association' then 'entity_associations'
  end
$function$
;

CREATE OR REPLACE FUNCTION private.permanent_delete_record_label(p_table text, p_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j jsonb;
begin
  execute format('select to_jsonb(t) from public.%I t where t.id = $1', p_table) into j using p_id;
  if j is null then return null; end if;
  return coalesce(case when p_table = 'case_packets' then 'packet:' || coalesce(j ->> 'packet_type', '')
                       when p_table = 'external_sources' then 'source:' || coalesce(j ->> 'source_number', '')
                       -- NEW (20261106120000): an association has no name of its own; the
                       -- claim is the only stable thing to show in the Trash.
                       when p_table = 'entity_associations' then 'association:' || coalesce(j ->> 'association', '') end,
                  nullif(btrim(coalesce(j ->> 'ci_number', '')), ''), nullif(btrim(coalesce(j ->> 'case_number', '')), ''), nullif(btrim(coalesce(j ->> 'name', '')), ''),
                  nullif(btrim(coalesce(j ->> 'plate', '')), ''), nullif(btrim(coalesce(j ->> 'title', '')), ''),
                  nullif(btrim(coalesce(j ->> 'label', '')), ''), nullif(btrim(coalesce(j ->> 'item_code', '')), ''),
                  nullif(btrim(coalesce(j ->> 'value', '')), ''), nullif(btrim(coalesce(j ->> 'code', '')), ''),
                  p_id::text);
end
$function$
;

CREATE OR REPLACE FUNCTION public.trash_list(p_kind text DEFAULT NULL::text, p_limit integer DEFAULT 300)
 RETURNS TABLE(kind text, id uuid, label text, case_id uuid, case_number text, deleted_at timestamp with time zone, deleted_by uuid, deleted_by_name text, delete_reason text, delete_batch uuid, restorable boolean, permanently_deletable boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_kinds text[] := array['person', 'vehicle', 'gang', 'place', 'account', 'indicator', 'narcotic', 'operation',
                          'tracker', 'gang_member', 'gang_turf', 'person_place', 'person_vehicle',
                          'person_relationship', 'account_link', 'case', 'report', 'media', 'evidence',
                          'case_task', 'case_message', 'case_intel_link', 'case_blocker', 'rico_case',
                          'predicate_act', 'case_note', 'case_link', 'ci', 'ci_intelligence', 'ci_contact', 'ci_payment',
                          'case_template', 'commendation', 'case_packet', 'external_source',
                          -- NEW (20261106120000)
                          'entity_association'];
  v_limit integer := greatest(1, least(coalesce(p_limit, 300), 500));
  v_owner boolean := private.is_owner();
  k text; t text; v_case text; v_extra text; v_sql text := '';
begin
  if not private.is_active() then return; end if;
  if p_kind is not null then
    k := lower(btrim(p_kind));
    if private.soft_delete_table(k) is null then raise exception 'unknown record kind'; end if;
    v_kinds := array[k];
  end if;
  foreach k in array v_kinds loop
    t := private.soft_delete_table(k);
    v_case := private.trash_case_expr(t);
    v_extra := case
      when t in ('ci_intelligence', 'ci_contacts', 'ci_payments') then ' and (x.case_id is null or private.can_read_case(x.case_id)) and private.can_access_ci(x.ci_id)'
      when t = 'confidential_informants' then ' and private.can_access_ci(x.id)'
      when t = 'external_sources' then ' and (x.case_id is null or private.can_read_case(x.case_id))'
      when t = 'cases' or v_case = 'null::uuid' then ''
      else format(' and private.can_read_case(%s)', v_case) end
      || case when t = 'media' then ' and (not x.restricted or private.is_owner())' else '' end;
    v_sql := v_sql || case when v_sql = '' then '' else ' union all ' end || format(
      '(select %L::text as kind, x.id, x.deleted_at, x.deleted_by, x.delete_reason, x.delete_batch, %s as case_id, %L::text as tbl
          from public.%I x
         where x.deleted_at is not null and private.perm_dispatch(''restore'', %L, x.id)%s
         order by x.deleted_at desc limit %s)',
      k, v_case, t, t, k, v_extra, v_limit);
  end loop;
  return query execute format(
    'select u.kind, u.id, coalesce(private.ci_trash_label(u.tbl, u.id), private.permanent_delete_record_label(u.tbl, u.id)), u.case_id,
            (select c.case_number from public.cases c where c.id = u.case_id),
            u.deleted_at, u.deleted_by,
            (select p.display_name from public.profiles p where p.id = u.deleted_by),
            u.delete_reason, u.delete_batch, true, %L::boolean
       from (%s) u
      order by u.deleted_at desc
      limit %s', v_owner, v_sql, v_limit);
end
$function$
;

create or replace function private.perm_dispatch(p_action text, p_kind text, p_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(case
    when p_kind = 'legal' then case p_action
      when 'read'    then private.can_view_legal_request(p_id, (select auth.uid()))
      when 'edit'    then private.can_edit_legal_draft(p_id, (select auth.uid()))
      when 'approve' then private.can_approve_legal(p_id, (select auth.uid()))
      -- Phase 4 (P4-03 … P4-11): the request-side actions the dossier shows.
      when 'comment'     then private.legal_can_comment(p_id, (select auth.uid()))
      when 'set_charges' then private.can_edit_legal_draft(p_id, (select auth.uid()))
      when 'decide'      then exists (select 1 from public.legal_requests r
                                       where r.id = p_id and r.review_status = 'judicial_review'
                                         and r.assigned_judge_id = (select auth.uid()))
      when 'amend'       then private.can_amend_legal(p_id, (select auth.uid()))
      when 'supersede'   then private.legal_is_command_authority(p_id, (select auth.uid()))
                              and exists (select 1 from public.legal_requests r where r.id = p_id
                                           and r.review_status in ('approved', 'partially_approved', 'denied', 'declined'))
      when 'cancel'      then private.legal_is_command_authority(p_id, (select auth.uid()))
                              and exists (select 1 from public.legal_requests r where r.id = p_id
                                           and r.review_status not in ('approved', 'partially_approved', 'denied',
                                                                       'withdrawn', 'declined', 'cancelled', 'superseded'))
      when 'export'      then private.can_view_legal_request(p_id, (select auth.uid()))
      when 'observe'     then private.can_set_legal_observer(p_id, (select auth.uid()))
      when 'assign_judge' then private.can_manage_legal_assignment(p_id, (select auth.uid()))
                              and exists (select 1 from public.legal_requests r where r.id = p_id
                                           and r.review_status = 'submitted_to_judge')
      else false end
    -- Phase 5 (P5-02/03/07): the report flow and the template administration.
    when p_kind = 'report' and p_action in ('submit', 'review', 'reopen', 'export') then case p_action
      when 'submit' then exists (select 1 from public.reports r where r.id = p_id
                                  and r.deleted_at is null and r.author_id = (select auth.uid())
                                  and not r.finalized and r.review_status in ('draft', 'returned')
                                  and private.case_writable(r.case_id))
      when 'review' then private.can_review_report(p_id, (select auth.uid()))
                         and exists (select 1 from public.reports r where r.id = p_id and r.review_status = 'submitted')
      when 'reopen' then private.can_reopen_report(p_id, (select auth.uid()))
      when 'export' then exists (select 1 from public.reports r where r.id = p_id
                                  and (r.deleted_at is null or private.is_owner()) and private.can_read_case(r.case_id))
      else false end
    when p_kind = 'report_template' then case p_action
      when 'propose' then private.report_template_proposer()
      when 'publish' then private.report_template_admin()
      else false end
    -- Phase 6 (P6-01 … P6-08): the intelligence record's own actions.
    when p_kind = 'field_submission' then (
      select case p_action
        when 'read'     then private.field_submission_readable(p_id)
        when 'reject'   then private.is_active() and private.field_submission_readable(p_id)
                             and s.status in ('new', 'reviewing', 'needs_info', 'reviewed', 'actionable')
        when 'restore'  then private.field_submission_readable(p_id)
                             and ((s.status = 'archived' and private.is_active())
                                  or (s.status = 'rejected' and private.is_command()))
        when 'comment'  then private.is_active() and private.field_submission_readable(p_id) and s.status <> 'draft'
        when 'validate' then private.is_active() and private.field_submission_readable(p_id)
                             and s.status not in ('draft', 'archived', 'rejected')
        when 'group'    then private.is_active() and private.field_submission_readable(p_id) and s.status <> 'draft'
        when 'convert'  then private.is_active() and private.field_submission_readable(p_id) and s.status <> 'draft'
        when 'link'     then private.is_active() and private.field_submission_readable(p_id) and s.status <> 'draft'
        when 'assign'   then private.is_command() and private.field_submission_readable(p_id) and s.status <> 'draft'
        when 'delete'   then private.is_command() and s.deleted_at is null
        when 'undelete' then private.is_owner() and s.deleted_at is not null
        else false end
      from public.field_submissions s where s.id = p_id)
    when p_kind = 'case' and p_action in ('access', 'archive', 'unarchive', 'grant_access', 'delete_child', 'permanent_delete') then case p_action
      when 'access'       then private.can_access_case(p_id)
      when 'archive'      then private.is_command()
                               and exists (select 1 from public.cases c where c.id = p_id and c.archived_at is null and c.deleted_at is null)
                               and not private.case_has_active_hold(p_id)
      when 'unarchive'    then private.is_command()
                               and exists (select 1 from public.cases c where c.id = p_id and c.archived_at is not null and c.deleted_at is null)
      when 'grant_access' then private.can_grant_case(p_id)
                               and exists (select 1 from public.cases c where c.id = p_id and c.deleted_at is null)
      when 'delete_child' then private.can_delete_case_child(p_id)
      when 'permanent_delete' then private.is_owner()
                               and exists (select 1 from public.cases c where c.id = p_id
                                            and (c.archived_at is not null or c.deleted_at is not null))
      else false end
    -- Phase 7 (P7-01 … P7-04): the queue's own state, the Owner's sweep, and
    -- reassignment — placed BEFORE the registry arm, which lists case_task /
    -- case_blocker and would otherwise answer false for 'reassign'.
    when p_kind = 'action_item' then case p_action
      when 'set_state' then private.is_active()
      else false end
    when p_kind = 'action_escalation' then case p_action
      when 'sweep' then private.is_owner()
      else false end
    when p_kind = 'case_task' and p_action = 'reassign' then exists (
      select 1 from public.case_tasks t where t.id = p_id and t.deleted_at is null and not t.done
         and t.waived_at is null and private.can_grant_case(t.case_id) and private.case_writable(t.case_id))
    when p_kind = 'case_blocker' and p_action = 'reassign' then exists (
      select 1 from public.case_blockers b where b.id = p_id and b.deleted_at is null and b.status = 'open'
         and private.can_grant_case(b.case_id) and private.case_writable(b.case_id))
    -- Phase 8 (P8-02): the Trash is a read every active member has; each row
    -- is admitted by the 'restore' arm of the kind it belongs to.
    when p_kind = 'trash' then case p_action
      when 'list' then private.is_active()
      else false end
    when p_kind = 'case_assignment' and p_action = 'unassign' then exists (
      select 1 from public.case_assignments a where a.id = p_id and a.removed_at is null
         and a.assignment_source = 'standard'
         and private.can_delete_case_child(a.case_id) and private.case_writable(a.case_id))
    -- CI compartment (20261103120000): the catalog actions and the four
    -- soft-deletable CI kinds, placed BEFORE the registry arm. A read answers
    -- false alike for "not yours" and "does not exist" (never raises). For
    -- ('record', 'ci_payment') p_id is the CI (or null: "may record at all").
    when p_kind = 'ci' and p_action in ('access', 'create', 'set_status', 'assign_handler', 'export', 'sweep') then case p_action
      when 'access'         then private.can_access_ci(p_id)
      when 'create'         then private.has_full_ci_access() or private.ci_is_handler()
      when 'set_status'     then private.has_full_ci_access() and (p_id is null or private.can_access_ci(p_id))
      when 'assign_handler' then private.has_full_ci_access() and (p_id is null or private.can_access_ci(p_id))
      when 'export'         then case when p_id is null then private.has_full_ci_access() else private.can_access_ci(p_id) end
      when 'sweep'          then private.is_owner()
      else false end
    when p_kind = 'ci_capacity' then case p_action
      when 'request' then private.is_active()
      when 'decide'  then private.has_full_ci_access()
      else false end
    when p_kind = 'ci_intelligence' and p_action = 'release' then
      private.has_full_ci_access() and (p_id is null or private.ci_kind_readable('ci_intelligence', p_id))
    when p_kind = 'ci_payment' and p_action = 'record' then
      case when p_id is null then private.is_active() and (private.has_full_ci_access() or private.ci_is_handler())
           else private.can_access_ci(p_id) end
    when p_kind in ('ci', 'ci_intelligence', 'ci_contact', 'ci_payment') then case p_action
      when 'read'        then private.ci_kind_readable(p_kind, p_id)
      when 'edit'        then private.ci_kind_readable(p_kind, p_id)
      when 'soft_delete' then private.ci_kind_deletable(p_kind, p_id)
      when 'delete'      then private.ci_kind_deletable(p_kind, p_id)
      when 'restore'     then private.has_full_ci_access()
                              and (select st.p_exists and st.p_deleted_at is not null from private.soft_delete_state(p_kind, p_id) st)
      when 'permanent_delete' then private.is_owner() and private.has_full_ci_access()
                              and (select st.p_exists and st.p_deleted_at is not null from private.soft_delete_state(p_kind, p_id) st)
      else false end
    -- Soft delete for case templates and commendations (20261104120000):
    -- read = any active member (a deleted row only the Owner); edit / delete =
    -- command or the Owner (a commendation also by its creator); restore = the
    -- Owner or command; permanent delete = the Owner's armed protocol. Before
    -- the registry arm, which does not list these kinds.
    when p_kind in ('case_template', 'commendation') then (
      select case p_action
        when 'read' then st.p_exists and private.is_active() and (st.p_deleted_at is null or private.is_owner())
        when 'edit' then st.p_exists and st.p_deleted_at is null
                         and (private.is_command() or private.is_owner()
                              or (p_kind = 'commendation' and private.is_active()
                                  and exists (select 1 from public.commendations x where x.id = p_id and x.created_by = (select auth.uid()))))
        when 'soft_delete' then st.p_exists and st.p_deleted_at is null
                         and (private.is_command() or private.is_owner()
                              or (p_kind = 'commendation' and private.is_active()
                                  and exists (select 1 from public.commendations x where x.id = p_id and x.created_by = (select auth.uid()))))
        when 'delete' then st.p_exists and st.p_deleted_at is null
                         and (private.is_command() or private.is_owner()
                              or (p_kind = 'commendation' and private.is_active()
                                  and exists (select 1 from public.commendations x where x.id = p_id and x.created_by = (select auth.uid()))))
        when 'restore' then st.p_exists and st.p_deleted_at is not null and (private.is_owner() or private.is_command())
        when 'permanent_delete' then private.is_owner() and st.p_exists and st.p_deleted_at is not null
        else false end
      from private.soft_delete_state(p_kind, p_id) st)
    -- Platform upgrade (20261105120000): evidence integrity, case packets,
    -- evidence bundles, document tools, external sources, the crawler policy,
    -- the graph, search, background jobs, system health, feature flags and
    -- manifests. For ('request', 'case_packet'), ('request', 'evidence_bundle')
    -- and ('tool', 'document') p_id is the CASE; for ('submit',
    -- 'external_source') the case or null; for the evidence actions the media.
    when p_kind = 'evidence' and p_action in ('register', 'verify', 'transfer', 'seal', 'release', 'access_log', 'chain_verify') then (
      select case p_action
        when 'register'     then m.storage_path is not null and m.external_url is null and m.sha256 is null and m.case_id is not null
                                 and private.perm_registry_visible('media', p_id) and private.case_writable(m.case_id)
                                 and (m.uploaded_by = (select auth.uid()) or private.is_command())
        when 'verify'       then m.sha256 is not null and private.perm_registry_visible('media', p_id)
        when 'transfer'     then m.sha256 is not null and private.perm_registry_visible('media', p_id)
                                 and (m.current_custodian = (select auth.uid()) or m.uploaded_by = (select auth.uid()) or private.is_command())
        when 'seal'         then m.sha256 is not null and m.sealed_at is null and m.integrity_status = 'verified'
                                 and private.flag_on('evidence_sealing') and private.perm_registry_visible('media', p_id)
                                 and (m.uploaded_by = (select auth.uid()) or private.can_edit_narcotics_intel())
        when 'release'      then m.sha256 is not null and private.is_command() and private.perm_registry_visible('media', p_id)
        when 'access_log'   then m.sha256 is not null and private.perm_registry_visible('media', p_id)
        when 'chain_verify' then private.perm_registry_visible('media', p_id)
        else false end
      from public.media m where m.id = p_id and m.deleted_at is null)
    when p_kind = 'case_packet' then (
      select case p_action
        when 'request'  then private.is_active() and private.can_read_case(p_id)
        when 'read'     then st.p_exists and (st.p_deleted_at is null or private.is_owner()) and private.can_read_case(st.p_case)
                             and (private.is_command() or private.is_owner()
                                  or exists (select 1 from public.case_packets x where x.id = p_id and x.requested_by = (select auth.uid())))
        when 'download' then st.p_exists and st.p_deleted_at is null and private.can_read_case(st.p_case)
                             and exists (select 1 from public.case_packets x where x.id = p_id and x.status = 'ready')
                             and (private.is_command() or private.is_owner()
                                  or exists (select 1 from public.case_packets x where x.id = p_id and x.requested_by = (select auth.uid())))
        when 'soft_delete' then st.p_exists and st.p_deleted_at is null and private.can_read_case(st.p_case)
                             and (private.is_command() or private.is_owner()
                                  or exists (select 1 from public.case_packets x where x.id = p_id and x.requested_by = (select auth.uid())))
        when 'delete'   then st.p_exists and st.p_deleted_at is null and private.can_read_case(st.p_case)
                             and (private.is_command() or private.is_owner()
                                  or exists (select 1 from public.case_packets x where x.id = p_id and x.requested_by = (select auth.uid())))
        when 'restore'  then st.p_exists and st.p_deleted_at is not null and private.can_read_case(st.p_case)
                             and (private.is_command() or private.is_owner()
                                  or exists (select 1 from public.case_packets x where x.id = p_id and x.requested_by = (select auth.uid())))
        when 'permanent_delete' then private.is_owner() and st.p_exists and st.p_deleted_at is not null
        else false end
      from private.soft_delete_state('case_packet', p_id) st)
    when p_kind = 'evidence_bundle' then case p_action
      when 'request' then private.is_active() and private.can_read_case(p_id)
      else false end
    when p_kind = 'document' then case p_action
      when 'tool'    then private.is_active() and private.case_writable(p_id)
      when 'extract' then exists (select 1 from public.media m where m.id = p_id and m.deleted_at is null and m.storage_path is not null
                                    and m.storage_path like 'case/' || m.case_id::text || '/' || m.id::text || '/%'
                                    and private.is_active() and private.perm_registry_visible('media', p_id))
      when 'search'  then private.is_active()
      else false end
    when p_kind = 'external_source' then (
      select case p_action
        when 'submit'  then private.is_active() and (p_id is null or private.can_read_case(p_id))
        when 'read'    then private.external_source_visible(p_id)
        when 'verify'  then st.p_exists and st.p_deleted_at is null and private.external_source_visible(p_id)
        when 'link'    then st.p_exists and st.p_deleted_at is null and private.external_source_visible(p_id)
        when 'recrawl' then st.p_exists and st.p_deleted_at is null and private.external_source_visible(p_id)
        when 'edit'    then st.p_exists and st.p_deleted_at is null and private.external_source_visible(p_id)
                            and (private.is_command() or private.is_owner()
                                 or exists (select 1 from public.external_sources x where x.id = p_id and x.submitted_by = (select auth.uid())))
        when 'soft_delete' then st.p_exists and st.p_deleted_at is null and private.external_source_visible(p_id)
                            and (private.is_command() or private.is_owner()
                                 or exists (select 1 from public.external_sources x where x.id = p_id and x.submitted_by = (select auth.uid())))
        when 'delete'  then st.p_exists and st.p_deleted_at is null and private.external_source_visible(p_id)
                            and (private.is_command() or private.is_owner()
                                 or exists (select 1 from public.external_sources x where x.id = p_id and x.submitted_by = (select auth.uid())))
        when 'restore' then st.p_exists and st.p_deleted_at is not null and (st.p_case is null or private.can_read_case(st.p_case))
                            and (private.is_command() or private.is_owner()
                                 or exists (select 1 from public.external_sources x where x.id = p_id and x.submitted_by = (select auth.uid())))
        when 'permanent_delete' then private.is_owner() and st.p_exists and st.p_deleted_at is not null
        else false end
      from private.soft_delete_state('external_source', p_id) st)
    when p_kind = 'crawler' then case p_action
      when 'policy' then private.is_owner()
      else false end
    when p_kind = 'graph' then case p_action
      when 'expand' then private.is_active()
      else false end
    when p_kind = 'semantic' then case p_action
      when 'search' then private.is_active()
      else false end
    when p_kind = 'search' then case p_action
      when 'authorize' then private.is_active()
      else false end
    when p_kind = 'background_job' then case p_action
      when 'cancel' then private.is_owner()
                         or exists (select 1 from public.background_jobs j where j.id = p_id and j.created_by = (select auth.uid()) and j.status = 'queued')
      when 'retry'  then private.is_owner()
      else false end
    when p_kind = 'system_health' then case p_action
      when 'read' then private.is_owner()
      else false end
    when p_kind = 'feature_flag' then case p_action
      when 'set' then private.is_owner()
      else false end
    when p_kind = 'manifest' then case p_action
      when 'verify' then exists (select 1 from public.export_manifests x where x.id = p_id and private.is_active()
                                    and ((x.case_id is not null and private.can_read_case(x.case_id)) or x.created_by = (select auth.uid())))
      else false end
    -- NEW (20261106120000): entity_associations. Not part of the generic
    -- registry arm below, because its visibility is the AND of two registry
    -- records rather than one, and because amending or withdrawing it is the
    -- author's or command's call, not the subject record's edit right.
    when p_kind = 'entity_association' then (
      select case p_action
        when 'read'   then st.p_exists and (st.p_deleted_at is null or private.is_owner()) and private.assoc_visible(p_id)
        when 'create' then private.is_active()
        when 'decide' then st.p_exists and st.p_deleted_at is null and private.assoc_visible(p_id)
        when 'edit'   then st.p_exists and st.p_deleted_at is null and private.assoc_visible(p_id) and private.assoc_author_or_command(p_id)
        when 'soft_delete' then st.p_exists and st.p_deleted_at is null and private.assoc_visible(p_id) and private.assoc_author_or_command(p_id)
        when 'delete'      then st.p_exists and st.p_deleted_at is null and private.assoc_visible(p_id) and private.assoc_author_or_command(p_id)
        when 'restore'     then st.p_exists and st.p_deleted_at is not null and private.assoc_author_or_command(p_id)
        when 'permanent_delete' then private.is_owner() and st.p_exists and st.p_deleted_at is not null
        else false end
      from private.soft_delete_state('entity_association', p_id) st)
    when p_kind in ('person', 'vehicle', 'gang', 'place', 'account', 'indicator', 'narcotic', 'operation', 'tracker', 'gang_member', 'gang_turf', 'person_place', 'person_vehicle', 'person_relationship', 'account_link', 'case', 'report', 'media', 'evidence', 'case_task', 'case_message', 'case_intel_link', 'case_blocker', 'rico_case', 'predicate_act', 'case_note', 'case_link') then (
      select case p_action
        when 'read' then st.p_exists and (st.p_deleted_at is null or private.is_owner())
                         and private.perm_registry_visible(p_kind, p_id)
        when 'edit' then st.p_exists and st.p_deleted_at is null
                         and (p_kind <> 'case' or exists (select 1 from public.cases c where c.id = p_id and c.archived_at is null))
                         and private.perm_registry_edit(p_kind, p_id)
        when 'soft_delete' then st.p_exists and st.p_deleted_at is null and private.perm_registry_delete(p_kind, p_id)
        when 'delete'      then st.p_exists and st.p_deleted_at is null and private.perm_registry_delete(p_kind, p_id)
        when 'restore'     then st.p_exists and st.p_deleted_at is not null
                                and (private.is_owner() or private.perm_registry_delete(p_kind, p_id))
        -- P1-05: field-level history follows the read; a restore is an edit
        -- (a finalized report and a legal request are display-only).
        when 'read_history' then private.version_table(p_kind) is not null
                                and st.p_exists and (st.p_deleted_at is null or private.is_owner())
                                and private.perm_registry_visible(p_kind, p_id)
        when 'restore_version' then private.version_table(p_kind) is not null
                                and st.p_exists and st.p_deleted_at is null
                                and (p_kind <> 'case' or exists (select 1 from public.cases c where c.id = p_id and c.archived_at is null))
                                and private.perm_registry_edit(p_kind, p_id)
                                and not (p_kind = 'report' and exists (select 1 from public.reports r where r.id = p_id and r.finalized))
        -- P1-07: the Owner permanently deletes from the Trash (an archived
        -- case too); the protocol's own preview refuses live dependants.
        when 'permanent_delete' then private.is_owner() and st.p_exists and st.p_deleted_at is not null
        else false end
      from private.soft_delete_state(p_kind, p_id) st)
    else false end, false)
$$;

CREATE OR REPLACE FUNCTION private.permanent_delete_record_apply(p_kind text, p_table text, p_id uuid, p_reason text, p_armed_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_snapshot jsonb; v_batch uuid; v_refs jsonb; v_assets jsonb; v_ledger uuid; v_label text;
  v_paths text[]; v_storage_ok boolean := true; t text;
  v_assoc_kind text; v_assoc int := 0;
  v_leaf_first text[] := array['predicate_acts', 'rico_cases', 'case_blockers', 'case_intel_links', 'case_messages',
                               'case_tasks', 'evidence', 'media', 'reports', 'gang_members', 'gang_turf',
                               'person_places', 'person_vehicles', 'person_relationships', 'account_links',
                               'persons', 'vehicles', 'gangs', 'places', 'accounts', 'indicators', 'narcotics',
                               'operations', 'trackers', 'cases'];
begin
  execute format('select to_jsonb(t) from public.%I t where t.id = $1', p_table) into v_snapshot using p_id;
  if v_snapshot is null then raise exception 'record not found'; end if;
  v_batch := (v_snapshot ->> 'delete_batch')::uuid;
  v_label := private.permanent_delete_record_label(p_table, p_id);
  v_refs := private.permanent_delete_record_refs(p_table, p_id);
  v_assets := private.permanent_delete_record_assets(p_table, p_id);

  insert into public.deleted_record_ledger
    (kind, table_name, record_id, label, snapshot, destroyed, unlinked, storage_objects, external_assets,
     reason, deleted_by, armed_at)
  values (p_kind, p_table, p_id, v_label, v_snapshot, v_refs -> 'destroyed', v_refs -> 'unlinked',
          v_assets -> 'storage_objects', v_assets -> 'external_assets', p_reason, v_uid, p_armed_at)
  returning id into v_ledger;

  select coalesce(array_agg(x), '{}') into v_paths from jsonb_array_elements_text(v_assets -> 'storage_objects') x;
  if cardinality(v_paths) > 0 then
    begin
      delete from storage.objects o where o.bucket_id = 'field-evidence' and o.name = any (v_paths);
    exception when others then
      v_storage_ok := false;
      update public.deleted_record_ledger
         set external_assets = external_assets || jsonb_build_object('storage_error', left(sqlerrm, 300))
       where id = v_ledger;
    end;
  end if;

  if v_batch is not null then
    foreach t in array v_leaf_first loop
      execute format('delete from public.%I where delete_batch = $1 and id <> $2', t) using v_batch, p_id;
    end loop;
  end if;
  -- NEW (20261106120000): entity_associations points at a registry record
  -- POLYMORPHICALLY (subject_id / object_id are plain uuids, not foreign
  -- keys), so the FK walk in permanent_delete_record_refs cannot see it and
  -- nothing would clean it up. A destroyed record takes its association rows
  -- with it; the count is recorded in the ledger like any other destruction.
  v_assoc_kind := case p_table
    when 'gangs' then 'gang' when 'persons' then 'person' when 'places' then 'place'
    when 'vehicles' then 'vehicle' when 'narcotics' then 'narcotic'
    when 'accounts' then 'account' when 'indicators' then 'indicator' end;
  if v_assoc_kind is not null then
    delete from public.entity_associations a
     where (a.subject_kind = v_assoc_kind and a.subject_id = p_id)
        or (a.object_kind = v_assoc_kind and a.object_id = p_id);
    get diagnostics v_assoc = row_count;
    if v_assoc > 0 then
      v_refs := jsonb_set(v_refs, array['destroyed', 'entity_associations'], to_jsonb(v_assoc));
      update public.deleted_record_ledger set destroyed = v_refs -> 'destroyed' where id = v_ledger;
    end if;
  end if;
  execute format('delete from public.%I where id = $1', p_table) using p_id;

  return jsonb_build_object('ledger_id', v_ledger, 'label', v_label, 'destroyed', v_refs -> 'destroyed',
                            'unlinked', v_refs -> 'unlinked', 'storage_objects', v_assets -> 'storage_objects',
                            'storage_ok', v_storage_ok, 'external_assets', v_assets -> 'external_assets');
end $function$
;
-- ---------------------------------------------------------------------------
-- 3.3 permission_catalog — the rows the matrix and the client mirror read
-- ---------------------------------------------------------------------------
insert into public.permission_catalog (action, kind, area, rule, enforcing_object, test_id, matrix, sort_order) values
  ('create', 'entity_association', 'Record an association between two records', 'Any active member who can see BOTH records. The row always lands on status Pending Investigation — recording an observation is never a finding, and never implies alliance, merger or control. An identical live pair is returned rather than duplicated.', 'public.entity_association_create → private.perm_dispatch(entity_association)', 'v193a', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 860),
  ('read', 'entity_association', 'See an association', 'Any active member who can see BOTH records it names. A link never reveals a record the reader could not otherwise see: the SIU and CI walls apply to each endpoint independently.', 'entity_associations_sel / public.entity_associations_for', 'v193a', '{"owner":"✓","command":"✓","member":"both ends","inactive":"✗"}', 862),
  ('decide', 'entity_association', 'Confirm, reject or retire an association', 'Any active member who can see both records rules on it, with a reason. The decision, its author and its time are recorded; the claim itself may be corrected at the same time. Returning it to Pending Investigation clears the decision.', 'public.entity_association_decide', 'v193a', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 864),
  ('edit', 'entity_association', 'Amend an association', 'The member who recorded it, or command. Only the descriptive fields — note, confidence, source type, first observed, last confirmed. The claim and the status change through decide, not here.', 'public.entity_association_update → private.perm_dispatch(entity_association)', 'v193a', '{"owner":"✓","command":"✓","member":"author","inactive":"✗"}', 866),
  ('soft_delete', 'entity_association', 'Withdraw an association', 'The member who recorded it, or command; it goes to the Trash. Rejecting an association is usually the right action — a withdrawal says it should never have been recorded.', 'public.soft_delete → private.perm_dispatch(entity_association)', 'v193a', '{"owner":"✓","command":"✓","member":"author","inactive":"✗"}', 868),
  ('restore', 'entity_association', 'Restore an association', 'The member who recorded it, command or the Owner, from the Trash; the Owner may permanently delete it. Permanently deleting either record it names destroys it outright.', 'public.restore_record → private.perm_dispatch(entity_association)', 'v193a', '{"owner":"✓","command":"✓","member":"author","inactive":"✗"}', 870),
  ('attach', 'registry_media', 'Attach a photograph to a registry record', 'Any active member who can see the record. The row is reserved first and the ORIGINAL bytes upload to the private case-evidence bucket under registry/<kind>/<id>/<media_id>/; the object is bound to that row and that record and cannot be planted elsewhere. Registry intelligence is not case evidence: no EV- number, no custody chain, no integrity sweep.', 'public.registry_media_attach / storage registry_media_write', 'v193a', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 872)
on conflict (action, kind) do update
  set area = excluded.area, rule = excluded.rule, enforcing_object = excluded.enforcing_object,
      test_id = excluded.test_id, matrix = excluded.matrix, sort_order = excluded.sort_order,
      updated_at = now();

-- ---------------------------------------------------------------------------
-- ROLLBACK NOTE
-- ---------------------------------------------------------------------------
-- This migration is additive. To undo it: drop the two storage policies
-- (registry_media_read, registry_media_write), drop public.registry_media_attach,
-- drop the four entity_association RPCs and the four private helpers, delete the
-- seven permission_catalog rows, re-emit the five plumbing functions from the
-- 20261105120000 text, and finally drop public.entity_associations. The media
-- rows and the objects under registry/ are a retention decision, not a schema
-- one — decide them separately.

-- ===== PART 4: org_associations_rls_test_cleanup =====

-- ---------------------------------------------------------------------------
-- 4.1 public.rls_test_cleanup — the fixtures' association and registry-media
--     rows. Spliced into the live text (the 20261105120000 §5.7 pattern):
--     the function is long and is edited by every phase, so re-emitting it
--     whole would fight the next phase for the same lines. The splice is
--     idempotent and refuses if either anchor has moved.
--
--     Two additions:
--       · entity_associations rows a fixture recorded, decided or deleted,
--         AND any row pointing at a fixture-created registry record. The
--         endpoints are polymorphic — subject_id / object_id are plain uuids,
--         not foreign keys — so nothing cascades them and a leaked row would
--         outlive the record it names.
--       · the caseless-media sweep now also takes registry/… objects, not
--         only case/… ones (PART 2 gave registry intelligence its own prefix).
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text;
  v_media_anchor text := $a$  delete from public.media where uploaded_by = any(ids) and case_id is null and storage_path like 'case/%';$a$;
  v_media_new text := $a$  delete from public.media where uploaded_by = any(ids) and case_id is null and (storage_path like 'case/%' or storage_path like 'registry/%');$a$;
  v_assoc_anchor text := $a$  delete from public.entity_merges where actor_id = any(ids) or reversed_by = any(ids);$a$;
  v_assoc_add text := $a$  delete from public.entity_associations
   where created_by = any(ids) or decided_by = any(ids) or deleted_by = any(ids)
      or subject_id in (select id from public.persons where created_by = any(ids)
                        union all select id from public.vehicles where created_by = any(ids)
                        union all select id from public.gangs where created_by = any(ids)
                        union all select id from public.places where created_by = any(ids))
      or object_id in (select id from public.persons where created_by = any(ids)
                       union all select id from public.vehicles where created_by = any(ids)
                       union all select id from public.gangs where created_by = any(ids)
                       union all select id from public.places where created_by = any(ids));
$a$;
begin
  v_def := pg_get_functiondef('public.rls_test_cleanup()'::regprocedure);
  if v_def like '%delete from public.entity_associations%' then return; end if;
  if (length(v_def) - length(replace(v_def, v_media_anchor, ''))) / length(v_media_anchor) <> 1 then
    raise exception 'rls_test_cleanup media anchor not found exactly once';
  end if;
  if (length(v_def) - length(replace(v_def, v_assoc_anchor, ''))) / length(v_assoc_anchor) <> 1 then
    raise exception 'rls_test_cleanup entity_merges anchor not found exactly once';
  end if;
  v_def := replace(v_def, v_media_anchor, v_media_new);
  v_def := replace(v_def, v_assoc_anchor, v_assoc_anchor || E'\n' || v_assoc_add);
  execute v_def;
end $do$;

-- ===== PART 5: org_associations_review_fixes =====

-- ---------------------------------------------------------------------------
-- 5.1 Three things the verification pass found, all in the same shape: the
--     RPCs trusted inputs they should have checked, so a bad one escaped as a
--     raw Postgres error instead of the house refusal, and one of them let a
--     photograph of RESTRICTED intelligence be published.
--
--   (a) A record that does not exist. private.perm_registry_visible answers
--       "may the caller SEE it", and for the four SIU-walled kinds it never
--       touches the table — so any random uuid passed it, and an association
--       could be recorded between two records that were never there (or a
--       photograph attached to one). private.registry_exists is the missing
--       half: the row exists AND is live. Both RPCs now require both.
--   (b) Vocabulary and date values went straight to the CHECK constraints and
--       to ::date, so an unknown kind, claim, confidence or source type came
--       back as a 23514 and a malformed date as a 22007 — a stack trace to
--       the client. The house contract is that a bad value is
--       {ok:false, code:'bad_value'}; every vocabulary is now checked in the
--       RPC, and the two date casts are wrapped.
--   (c) A photograph of a RESTRICTED narcotic was stored restricted = false.
--       media_sel gates `restricted` on private.can_edit_narcotics_intel()
--       but has no narcotic_id arm of its own, so the picture of a restricted
--       substance would have been readable by every active member — exactly
--       the leak 20260804010000 closed for the imported sale screenshots.
--       registry_media_attach now mirrors the substance's own restriction
--       onto the media row (and reports it back to the caller).
--
--     The five functions are re-emitted whole from their live text.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.registry_exists(p_kind text, p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v boolean;
begin
  if p_id is null then return false; end if;
  case p_kind
    when 'gang'      then select true into v from public.gangs g      where g.id = p_id and g.deleted_at is null;
    when 'person'    then select true into v from public.persons p    where p.id = p_id and p.deleted_at is null;
    when 'place'     then select true into v from public.places pl    where pl.id = p_id and pl.deleted_at is null;
    when 'vehicle'   then select true into v from public.vehicles vh  where vh.id = p_id and vh.deleted_at is null;
    when 'narcotic'  then select true into v from public.narcotics n  where n.id = p_id and n.deleted_at is null;
    when 'account'   then select true into v from public.accounts a   where a.id = p_id and a.deleted_at is null;
    when 'indicator' then select true into v from public.indicators i where i.id = p_id and i.deleted_at is null;
    else v := false;
  end case;
  return coalesce(v, false);
end $function$
;

CREATE OR REPLACE FUNCTION public.entity_association_create(p_subject_kind text, p_subject_id uuid, p_object_kind text, p_object_id uuid, p_association text, p_note text DEFAULT NULL::text, p_confidence text DEFAULT NULL::text, p_source_type text DEFAULT NULL::text, p_first_observed date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := (select auth.uid()); v_id uuid; v_existing public.entity_associations;
        v_note text := nullif(btrim(coalesce(p_note, '')), '');
        v_kinds text[] := array['gang', 'person', 'place', 'vehicle', 'narcotic', 'account', 'indicator'];
begin
  if v_uid is null or not private.is_active() then
    perform private.perm_raise('create', 'entity_association', null, 'denied', 'not an active member');
  end if;
  -- Validate the vocabularies HERE rather than letting the CHECK constraints
  -- raise: a 23514 is a stack trace to the client, and the house contract is
  -- that a bad value comes back as {ok:false}.
  if not (p_subject_kind = any (v_kinds)) or not (p_object_kind = any (v_kinds)) then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown record kind');
  end if;
  if p_association is null or p_association not in (
       'unconfirmed_association', 'alliance', 'rivalry', 'conflict',
       'shared_property', 'business_relationship', 'supplier', 'subsidiary',
       'splinter', 'successor', 'observed_at', 'operates_from', 'controls', 'other') then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown association');
  end if;
  if p_confidence is not null and p_confidence not in ('confirmed', 'probable', 'possible', 'unverified', 'disproven') then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown confidence');
  end if;
  if p_source_type is not null and p_source_type not in (
       'visual_intelligence', 'field_observation', 'informant', 'surveillance',
       'document', 'digital', 'interview', 'open_source', 'other') then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown source type');
  end if;
  if not private.perm_registry_visible(p_subject_kind, p_subject_id)
     or not private.perm_registry_visible(p_object_kind, p_object_id)
     -- perm_registry_visible answers "may the caller see it", and for the
     -- SIU-walled kinds it never reads the table — so an id that names nothing
     -- would pass. An association must join two records that exist.
     or not private.registry_exists(p_subject_kind, p_subject_id)
     or not private.registry_exists(p_object_kind, p_object_id) then
    perform private.perm_raise('create', 'entity_association', p_subject_id, 'not_found', 'record not found');
  end if;
  if p_subject_kind = p_object_kind and p_subject_id = p_object_id then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'a record cannot be associated with itself');
  end if;

  select * into v_existing from public.entity_associations
   where deleted_at is null and association = p_association
     and ((subject_kind = p_subject_kind and subject_id = p_subject_id and object_kind = p_object_kind and object_id = p_object_id)
          or (p_subject_kind = p_object_kind and subject_kind = p_object_kind and subject_id = p_object_id and object_kind = p_subject_kind and object_id = p_subject_id))
   limit 1;
  if found then
    return jsonb_build_object('ok', true, 'id', v_existing.id, 'created', false, 'status', v_existing.status,
                              'message', 'this association is already recorded');
  end if;

  insert into public.entity_associations (
    subject_kind, subject_id, object_kind, object_id, association, status,
    confidence, source_type, note, first_observed, created_by)
  values (p_subject_kind, p_subject_id, p_object_kind, p_object_id, p_association, 'pending_investigation',
          p_confidence, p_source_type, v_note, p_first_observed, v_uid)
  returning id into v_id;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'ENTITY_ASSOCIATION_CREATED', 'entity_associations', v_id,
          jsonb_build_object('subject_kind', p_subject_kind, 'subject_id', p_subject_id,
                             'object_kind', p_object_kind, 'object_id', p_object_id,
                             'association', p_association, 'status', 'pending_investigation',
                             'subject_label', private.registry_label(p_subject_kind, p_subject_id),
                             'object_label', private.registry_label(p_object_kind, p_object_id)));
  return jsonb_build_object('ok', true, 'id', v_id, 'created', true, 'status', 'pending_investigation');
end $function$
;

CREATE OR REPLACE FUNCTION public.entity_association_decide(p_id uuid, p_status text, p_note text DEFAULT NULL::text, p_association text DEFAULT NULL::text, p_confidence text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := (select auth.uid()); a public.entity_associations;
        v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  a := private.association_for('decide', p_id);
  if p_status not in ('pending_investigation', 'confirmed', 'rejected', 'historical') then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown status');
  end if;
  if p_association is not null and p_association not in (
       'unconfirmed_association', 'alliance', 'rivalry', 'conflict',
       'shared_property', 'business_relationship', 'supplier', 'subsidiary',
       'splinter', 'successor', 'observed_at', 'operates_from', 'controls', 'other') then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown association');
  end if;
  if p_confidence is not null and p_confidence not in ('confirmed', 'probable', 'possible', 'unverified', 'disproven') then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown confidence');
  end if;
  if p_status in ('confirmed', 'rejected') and v_note is null then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'confirming or rejecting an association needs a reason');
  end if;

  update public.entity_associations
     set status = p_status,
         association = coalesce(p_association, association),
         confidence = coalesce(p_confidence, confidence),
         decision_note = v_note,
         decided_by = case when p_status = 'pending_investigation' then null else v_uid end,
         decided_at = case when p_status = 'pending_investigation' then null else now() end,
         last_confirmed = case when p_status = 'confirmed' then current_date else last_confirmed end
   where id = p_id;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'ENTITY_ASSOCIATION_DECIDED', 'entity_associations', p_id,
          jsonb_build_object('from_status', a.status, 'to_status', p_status,
                             'from_association', a.association, 'to_association', coalesce(p_association, a.association),
                             'subject_label', private.registry_label(a.subject_kind, a.subject_id),
                             'object_label', private.registry_label(a.object_kind, a.object_id)));
  return jsonb_build_object('ok', true, 'id', p_id, 'status', p_status);
end $function$
;

CREATE OR REPLACE FUNCTION public.entity_association_update(p_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := (select auth.uid()); a public.entity_associations; v_keys text[];
        v_conf text; v_src text; v_first date; v_last date;
begin
  a := private.association_for('edit', p_id);
  if not (a.created_by = v_uid or private.is_command() or private.is_owner()) then
    perform private.perm_raise('edit', 'entity_association', p_id, 'denied', 'only the author or command may amend this association');
  end if;
  select array_agg(k) into v_keys from jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) k;
  if v_keys is null or not (v_keys <@ array['note', 'confidence', 'source_type', 'first_observed', 'last_confirmed']) then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'only note, confidence, source_type, first_observed and last_confirmed may be amended');
  end if;
  v_conf := case when p_patch ? 'confidence' then p_patch ->> 'confidence' else a.confidence end;
  v_src := case when p_patch ? 'source_type' then p_patch ->> 'source_type' else a.source_type end;
  if v_conf is not null and v_conf not in ('confirmed', 'probable', 'possible', 'unverified', 'disproven') then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown confidence');
  end if;
  if v_src is not null and v_src not in (
       'visual_intelligence', 'field_observation', 'informant', 'surveillance',
       'document', 'digital', 'interview', 'open_source', 'other') then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown source type');
  end if;
  -- A malformed date would raise 22007 out of the UPDATE; catch it here so the
  -- caller gets the house refusal shape instead.
  begin
    v_first := case when p_patch ? 'first_observed' then (p_patch ->> 'first_observed')::date else a.first_observed end;
    v_last := case when p_patch ? 'last_confirmed' then (p_patch ->> 'last_confirmed')::date else a.last_confirmed end;
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'a date must be YYYY-MM-DD');
  end;

  update public.entity_associations
     set note = case when p_patch ? 'note' then nullif(btrim(coalesce(p_patch ->> 'note', '')), '') else note end,
         confidence = v_conf, source_type = v_src, first_observed = v_first, last_confirmed = v_last
   where id = p_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'ENTITY_ASSOCIATION_UPDATED', 'entity_associations', p_id, jsonb_build_object('fields', to_jsonb(v_keys)));
  return jsonb_build_object('ok', true, 'id', p_id);
end $function$
;

CREATE OR REPLACE FUNCTION public.registry_media_attach(p_kind text, p_entity_id uuid, p_title text, p_filename text, p_mime text DEFAULT NULL::text, p_byte_size bigint DEFAULT NULL::bigint, p_category text DEFAULT NULL::text, p_caption text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid := gen_random_uuid();
  v_title text := left(nullif(btrim(coalesce(p_title, '')), ''), 200);
  v_caption text := nullif(btrim(coalesce(p_caption, '')), '');
  v_name text := left(regexp_replace(lower(btrim(coalesce(p_filename, ''))), '[^a-z0-9._-]+', '-', 'g'), 120);
  v_path text;
  v_restricted boolean;
begin
  if v_uid is null or not private.is_active() then
    perform private.perm_raise('attach', 'registry_media', p_entity_id, 'denied', 'not an active member');
  end if;
  if p_kind not in ('gang', 'person', 'place', 'vehicle', 'narcotic') then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'unknown record kind');
  end if;
  if not private.perm_registry_visible(p_kind, p_entity_id)
     or not private.registry_exists(p_kind, p_entity_id) then
    perform private.perm_raise('attach', 'registry_media', p_entity_id, 'not_found', 'record not found');
  end if;
  if v_title is null then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'a title is required');
  end if;
  v_name := nullif(btrim(v_name, '-.'), '');
  if v_name is null then v_name := 'upload'; end if;
  v_path := 'registry/' || p_kind || '/' || p_entity_id::text || '/' || v_id::text || '/' || v_name;

  -- A photograph of RESTRICTED narcotics intelligence is restricted itself.
  -- media_sel gates `restricted` on can_edit_narcotics_intel() but has no
  -- narcotic_id arm of its own, so leaving this false would publish the
  -- picture of a restricted substance to every active member — the leak
  -- 20260804010000 closed for the imported sale screenshots.
  v_restricted := p_kind = 'narcotic'
                  and exists (select 1 from public.narcotics n where n.id = p_entity_id and n.restricted);

  insert into public.media (id, title, type, storage_path, kind, category, tags, restricted,
                            gang_id, person_id, place_id, vehicle_id, narcotic_id,
                            mime, byte_size, original_filename, uploaded_by)
  values (v_id, v_title,
          case when coalesce(p_mime, '') like 'video/%' then 'video'::public.media_type
               when coalesce(p_mime, '') like 'image/%' then 'image'::public.media_type
               else 'document'::public.media_type end,
          v_path, 'registry_intel',
          case when p_category in ('scene', 'people', 'vehicles', 'places', 'surveillance', 'documents', 'other') then p_category else 'other' end,
          case when v_caption is null then '{}'::jsonb else jsonb_build_object('caption', v_caption) end,
          v_restricted,
          case when p_kind = 'gang' then p_entity_id end,
          case when p_kind = 'person' then p_entity_id end,
          case when p_kind = 'place' then p_entity_id end,
          case when p_kind = 'vehicle' then p_entity_id end,
          case when p_kind = 'narcotic' then p_entity_id end,
          nullif(btrim(coalesce(p_mime, '')), ''), p_byte_size,
          nullif(btrim(coalesce(p_filename, '')), ''), v_uid);

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'REGISTRY_MEDIA_ATTACHED', 'media', v_id,
          jsonb_build_object('kind', p_kind, 'entity_id', p_entity_id, 'title', v_title,
                             'label', private.registry_label(p_kind, p_entity_id),
                             'storage_path', v_path, 'restricted', v_restricted, 'caption', v_caption));
  return jsonb_build_object('ok', true, 'media_id', v_id, 'storage_path', v_path,
                            'bucket', 'case-evidence', 'restricted', v_restricted);
end $function$
;
revoke all on function private.registry_exists(text, uuid) from public, anon, authenticated;
revoke all on function public.entity_association_create(text, uuid, text, uuid, text, text, text, text, date) from public, anon;
grant execute on function public.entity_association_create(text, uuid, text, uuid, text, text, text, text, date) to authenticated, service_role;
revoke all on function public.entity_association_decide(uuid, text, text, text, text) from public, anon;
grant execute on function public.entity_association_decide(uuid, text, text, text, text) to authenticated, service_role;
revoke all on function public.entity_association_update(uuid, jsonb) from public, anon;
grant execute on function public.entity_association_update(uuid, jsonb) to authenticated, service_role;
revoke all on function public.registry_media_attach(text, uuid, text, text, text, bigint, text, text) from public, anon;
grant execute on function public.registry_media_attach(text, uuid, text, text, text, bigint, text, text) to authenticated, service_role;
