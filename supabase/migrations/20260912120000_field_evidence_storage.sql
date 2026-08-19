-- ============================================================================
-- Evidence for Field Intelligence submissions -- and the project's first
-- Supabase Storage bucket.
--
-- Priority 3. P2 gave patrol a structured report; this lets them back it up.
--
-- -- This introduces a second authorization system -----------------------------
-- Until now every access decision in this project was RLS on a table in
-- `public`. Storage is not that. A file in a bucket is governed by policies on
-- `storage.objects`, which is a DIFFERENT table with its OWN policies, and a
-- bucket marked public bypasses them entirely and serves anything in it to the
-- open internet with no auth at all.
--
-- That is why the project had no buckets before today: 238 media rows, every
-- one an external URL, and a migration that recorded plainly that the app
-- "never calls supabase.storage.*". Opening this surface is the significant
-- part of this migration, not the evidence table.
--
-- So the bucket is PRIVATE, and every read goes through a signed URL. There is
-- no public path to an evidence file, and pasting a storage URL into a browser
-- without a token gets nothing.
--
-- -- One authority, not two --------------------------------------------------
-- The obvious mistake would be to invent a second ownership model for files --
-- "the uploader owns the object" -- and end up with a file whose access rules
-- disagree with the report it belongs to. Instead the object PATH carries the
-- submission id:
--
--     field/<submission_id>/<uuid>.<ext>
--
-- and the storage policies resolve that id back through exactly the helpers the
-- submission tables already use: private.field_submission_mine() and
-- private.field_submission_my_draft(). A file is therefore visible precisely
-- when its report is, and writable precisely while its report is an unsent
-- draft. There is one rule, expressed once.
--
-- A path segment that is not a uuid is not an error to be caught later -- a
-- direct cast would raise 22P02 from inside a policy, which is a confusing way
-- to be denied. private.uuid_or_null() returns NULL instead, and NULL fails the
-- ownership test, so a malformed path is simply refused.
--
-- -- Medal and other hosted links are NOT uploads ------------------------------
-- A Medal clip is a page on medal.tv, not a file: there is nothing to download
-- and re-host, and trying would mean scraping a third party. The design says so
-- too -- do not make the officer download a clip and re-upload it. So evidence
-- has two shapes, `upload` and `link`, and a link keeps its original URL
-- untouched. `is_medal` is recorded at insert by a trigger rather than trusted
-- from the client, so a reviewer can be shown a player without the client
-- getting to claim what a URL is.
--
-- APPLICATION NOTE: applied live as field_evidence_storage.
-- ============================================================================

-- -- A safe uuid cast for use inside policies ---------------------------------
create or replace function private.uuid_or_null(p text)
returns uuid language plpgsql immutable set search_path to '' as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;
revoke all on function private.uuid_or_null(text) from public;
grant execute on function private.uuid_or_null(text) to authenticated, service_role;

-- -- The bucket ---------------------------------------------------------------
-- public = false is the whole point. A public bucket serves every object to
-- anyone who guesses the URL, with no policy consulted and no session required.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'field-evidence', 'field-evidence', false,
  52428800,  -- 50 MB. Enough for a phone clip; small enough that a mistake is cheap.
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'video/mp4', 'video/webm', 'video/quicktime',
        'application/pdf']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- -- Storage policies ---------------------------------------------------------
-- These are policies on storage.objects, NOT on any table in public. They are
-- the only thing standing between an authenticated account and every evidence
-- file, so they are written to derive from the submission rather than to
-- restate its rules in a second place.

drop policy if exists field_evidence_read on storage.objects;
create policy field_evidence_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'field-evidence'
    and (
      -- The officer who filed the report.
      private.field_submission_mine(
        private.uuid_or_null((storage.foldername(name))[2]))
      -- Or CID, once the report has actually been sent. A draft's attachments
      -- are as private as the draft.
      or (private.is_active() and exists (
            select 1 from public.field_submissions s
             where s.id = private.uuid_or_null((storage.foldername(name))[2])
               and s.status <> 'draft'))
    )
  );

drop policy if exists field_evidence_write on storage.objects;
create policy field_evidence_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'field-evidence'
    and (storage.foldername(name))[1] = 'field'
    -- Only into your own unsent report. After it is sent the evidence is fixed
    -- along with everything else.
    and private.field_submission_my_draft(
          private.uuid_or_null((storage.foldername(name))[2]))
  );

-- Deleting an attachment is part of editing a draft. Nothing removes a file
-- from a sent report; command can, for genuine mistakes.
drop policy if exists field_evidence_delete on storage.objects;
create policy field_evidence_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'field-evidence'
    and (private.field_submission_my_draft(
           private.uuid_or_null((storage.foldername(name))[2]))
         or private.is_command())
  );

-- Deliberately NO update policy. Overwriting an object in place would change
-- what a piece of evidence is while leaving its row, its title and its audit
-- trail describing the old one. Replacing evidence means deleting and adding.

-- -- The evidence rows ---------------------------------------------------------
create table if not exists public.field_submission_evidence (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.field_submissions(id) on delete cascade,

  -- upload: a file in the field-evidence bucket, addressed by storage_path.
  -- link:   something hosted elsewhere, kept as the officer pasted it.
  kind text not null check (kind in ('upload', 'link')),
  storage_path text,
  external_url text,

  -- Set by the trigger, never by the client, so "this is a Medal clip" is an
  -- observation about the URL rather than a claim the client gets to make.
  is_medal boolean not null default false,

  title text,
  description text,
  captured_at timestamptz,

  -- Which claim this supports. All nullable: evidence about the report as a
  -- whole is normal, and so is a photo that happens to show one specific car.
  person_id uuid references public.field_submission_persons(id) on delete set null,
  vehicle_id uuid references public.field_submission_vehicles(id) on delete set null,
  org_id uuid references public.field_submission_orgs(id) on delete set null,
  location_id uuid references public.field_submission_locations(id) on delete set null,
  item_id uuid references public.field_submission_items(id) on delete set null,

  added_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),

  -- An upload has a path and no URL; a link has a URL and no path. A row that
  -- is both, or neither, is not evidence of anything.
  constraint field_submission_evidence_shape check (
    (kind = 'upload' and storage_path is not null and external_url is null)
    or (kind = 'link' and external_url is not null and storage_path is null)
  ),
  -- Uploads must live under this submission's own folder. Without this an
  -- officer could file a row pointing at somebody else's object path; the
  -- storage policy would still refuse them the bytes, but the row would be a
  -- lie and a reviewer would see a broken attachment with no explanation.
  constraint field_submission_evidence_path_scoped check (
    storage_path is null
    or storage_path like 'field/' || submission_id::text || '/%'
  )
);

create index if not exists field_submission_evidence_submission_idx
  on public.field_submission_evidence (submission_id);

alter table public.field_submission_evidence enable row level security;

-- -- Stamping the parts the client does not get to assert -----------------------
create or replace function private.field_evidence_before_insert()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_host text;
begin
  new.added_by := (select auth.uid());
  new.created_at := now();

  if new.kind = 'link' then
    new.storage_path := null;
    -- Only http(s). A javascript: or data: URL in a field a reviewer will click
    -- is a scripting vector, and there is no legitimate evidence that needs one.
    if new.external_url !~* '^https?://' then
      raise exception 'evidence links must be http or https URLs';
    end if;
    v_host := lower(split_part(split_part(new.external_url, '://', 2), '/', 1));
    -- Recognised from the URL, not accepted from the client.
    new.is_medal := v_host = 'medal.tv' or v_host like '%.medal.tv';
  else
    new.external_url := null;
    new.is_medal := false;
  end if;

  return new;
end $$;

drop trigger if exists field_evidence_before_insert on public.field_submission_evidence;
create trigger field_evidence_before_insert before insert
  on public.field_submission_evidence
  for each row execute function private.field_evidence_before_insert();

-- Evidence is not edited. A title typo is fixed by removing the row and adding
-- it again while the report is still a draft; after that it is part of the
-- record. This keeps the row and the object it points at in step, and there is
-- no UPDATE policy below to allow otherwise.
drop trigger if exists field_evidence_audit on public.field_submission_evidence;
create trigger field_evidence_audit after insert or update or delete
  on public.field_submission_evidence
  for each row execute function private.audit();

-- -- Evidence policies ----------------------------------------------------------
-- Same shape as every other part of a submission: the parent decides.
drop policy if exists field_submission_evidence_sel on public.field_submission_evidence;
create policy field_submission_evidence_sel on public.field_submission_evidence
  for select to authenticated
  using (private.field_submission_mine(submission_id)
      or (private.is_active() and exists (
            select 1 from public.field_submissions s
             where s.id = submission_id and s.status <> 'draft')));

drop policy if exists field_submission_evidence_ins on public.field_submission_evidence;
create policy field_submission_evidence_ins on public.field_submission_evidence
  for insert to authenticated
  with check (private.field_submission_my_draft(submission_id));

drop policy if exists field_submission_evidence_del on public.field_submission_evidence;
create policy field_submission_evidence_del on public.field_submission_evidence
  for delete to authenticated
  using (private.field_submission_my_draft(submission_id) or private.is_command());

-- ============================================================================
-- Rollback: drop the table, the trigger function, the three storage policies,
-- private.uuid_or_null(), and delete the bucket -- which requires it to be
-- empty first, so a rollback after real evidence exists is a data decision and
-- not merely a schema one.
-- ============================================================================
