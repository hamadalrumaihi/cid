-- ============================================================================
-- Unified workspace, part 1 — case notes (Portal Improvements plan, Phase 3,
-- P3-03; decision CW5).
--
-- Purpose
--   Notes were three things — cases.notes (one free-text column), the chat,
--   and per-link notes. A case now carries AUTHORED notes: one row per note
--   with an author, timestamps, field-level history (record_versions), a
--   pin, and an optional restrict-to-command flag that keeps a note out of
--   every non-command reader's result. The legacy cases.notes text becomes
--   the first note of each case (author = the lead, else the creator;
--   source 'legacy'); the column stays readable for one release and is
--   frozen for clients.
--
-- Objects
--   public.case_notes
--     (id, case_id, author_id, body_md, pinned, restricted_to_command,
--      source manual|legacy, created_at, updated_at, soft-delete columns).
--     RLS: SELECT can_read_case and (not restricted or command / author /
--     Owner / SIB command on an SIB case), live rows (the Owner reads the
--     Trash); INSERT case_writable + author = caller (restricted only by
--     command); UPDATE case_writable + author or command; no DELETE (the
--     soft_delete RPC, kind 'case_note'). Triggers: touch, audit, version,
--     block_direct_soft_delete. Realtime: published.
--   cases.notes                          — frozen for clients (P0403).
--   kind 'case_note'                      — registered by 20261022120000
--     together with 'case_link' (the SQL-language helpers reference both
--     tables, so the registration follows the second table).
--   public.case_note_mention(p_note, p_user_ids)
--     The author names the members mentioned in a note; each active,
--     non-test recipient gets ONE note_mention notification per note per
--     hour (ids only — the client hydrates under RLS, and a recipient who
--     cannot read the case sees "an item you no longer have access to").
--   permission_catalog                   — note rows.
--
-- Authorization
--   As above; the server is the authority, NotesPanel mirrors it.
--
-- Side effects / Audit behaviour
--   private.audit() rows on every write; record_versions on every UPDATE;
--   CASE_NOTES_BACKFILLED once (entity 'system'); note_mention notifications.
--
-- APPLICATION NOTE: applied live as case_notes, then case_notes_policy_fix
--   (private.case_note_command — the first cut called is_siu_case from the
--   policies, which is not client-executable) and case_notes_version_table
--   (record_versions_table_check widened).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Table, RLS, triggers
-- ---------------------------------------------------------------------------
create table if not exists public.case_notes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  body_md text not null,
  pinned boolean not null default false,
  restricted_to_command boolean not null default false,
  source text not null default 'manual' check (source in ('manual', 'legacy')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  delete_batch uuid
);
create index if not exists case_notes_case_idx on public.case_notes (case_id, pinned desc, created_at desc) where deleted_at is null;
alter table public.case_notes enable row level security;
revoke all on table public.case_notes from public, anon;
grant select, insert, update on table public.case_notes to authenticated;
grant all on table public.case_notes to service_role;

-- Purpose:        the readers a command-restricted note is for — command,
--                 the Owner, or SIB command on an SIB case. Definer, and
--                 executable by authenticated because the policies below
--                 evaluate it as the caller (is_siu_case / siu_case_command
--                 themselves are not client-executable).
create or replace function private.case_note_command(p_case uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select private.is_command() or private.is_owner()
      or (private.is_siu_case(p_case) and private.siu_case_command(p_case))
$$;
revoke all on function private.case_note_command(uuid) from public, anon;
grant execute on function private.case_note_command(uuid) to authenticated, service_role;

drop policy if exists case_notes_sel on public.case_notes;
create policy case_notes_sel on public.case_notes for select to authenticated using (
  (private.is_live(deleted_at) or private.is_owner())
  and private.can_read_case(case_id)
  and (not restricted_to_command or author_id = (select auth.uid()) or private.case_note_command(case_id)));
drop policy if exists case_notes_ins on public.case_notes;
create policy case_notes_ins on public.case_notes for insert to authenticated with check (
  private.case_writable(case_id) and author_id = (select auth.uid())
  and (not restricted_to_command or private.case_note_command(case_id)));
drop policy if exists case_notes_upd on public.case_notes;
create policy case_notes_upd on public.case_notes for update to authenticated
  using ((private.is_live(deleted_at) or private.is_owner()) and private.case_writable(case_id)
         and (author_id = (select auth.uid()) or private.case_note_command(case_id)))
  with check ((private.is_live(deleted_at) or private.is_owner()) and private.case_writable(case_id)
         and (author_id = (select auth.uid()) or private.case_note_command(case_id))
         and (not restricted_to_command or private.case_note_command(case_id)));

drop trigger if exists case_notes_touch on public.case_notes;
create trigger case_notes_touch before update on public.case_notes for each row execute function private.touch();
drop trigger if exists case_notes_audit on public.case_notes;
create trigger case_notes_audit after insert or update or delete on public.case_notes for each row execute function private.audit();
-- record_versions accepts the new table.
alter table public.record_versions drop constraint if exists record_versions_table_check;
alter table public.record_versions add constraint record_versions_table_check
  check (table_name in ('cases', 'persons', 'vehicles', 'gangs', 'places', 'accounts', 'narcotics',
                        'evidence', 'reports', 'legal_requests', 'field_submissions', 'case_notes'));
drop trigger if exists case_notes_version on public.case_notes;
create trigger case_notes_version after update on public.case_notes for each row execute function private.version_row();
drop trigger if exists case_notes_block_direct_soft_delete on public.case_notes;
create trigger case_notes_block_direct_soft_delete before insert or update on public.case_notes
  for each row execute function private.block_direct_soft_delete();

-- The author never changes hands; a note's case never moves.
create or replace function private.case_notes_freeze()
returns trigger language plpgsql set search_path to '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.author_id is distinct from old.author_id or new.case_id is distinct from old.case_id
       or new.source is distinct from old.source then
      raise exception 'a note''s author, case and source are fixed' using errcode = 'P0403';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.case_notes_freeze() from public, anon, authenticated;
drop trigger if exists case_notes_freeze on public.case_notes;
create trigger case_notes_freeze before update on public.case_notes for each row execute function private.case_notes_freeze();

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'case_notes') then
    alter publication supabase_realtime add table public.case_notes;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Legacy backfill and the frozen column
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  set local statement_timeout = '60s';
  insert into public.case_notes (case_id, author_id, body_md, source, created_at, updated_at)
  select c.id, coalesce(c.lead_detective_id, c.created_by), c.notes, 'legacy', c.created_at, c.updated_at
    from public.cases c
   where nullif(btrim(coalesce(c.notes, '')), '') is not null
     and not exists (select 1 from public.case_notes n where n.case_id = c.id and n.source = 'legacy');
  get diagnostics n = row_count;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (null, 'CASE_NOTES_BACKFILLED', 'system', null, jsonb_build_object('rows', n));
end $$;

create or replace function private.block_case_notes_column()
returns trigger language plpgsql set search_path to '' as $$
begin
  if current_user in ('authenticated', 'anon') and new.notes is distinct from old.notes then
    raise exception 'cases.notes is read-only — notes live in case_notes' using errcode = 'P0403';
  end if;
  return new;
end $$;
revoke all on function private.block_case_notes_column() from public, anon, authenticated;
drop trigger if exists cases_block_notes_column on public.cases;
create trigger cases_block_notes_column before update on public.cases for each row execute function private.block_case_notes_column();

-- ---------------------------------------------------------------------------
-- 3. Mentions
-- ---------------------------------------------------------------------------
create or replace function public.case_note_mention(p_note uuid, p_user_ids uuid[])
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  n public.case_notes;
  v_sent int := 0;
begin
  select * into n from public.case_notes where id = p_note;
  if n.id is null or v_uid is null or n.author_id is distinct from v_uid or not private.perm_registry_visible('case_note', p_note) then
    return jsonb_build_object('ok', false, 'code', 'denied', 'message', 'only the note''s author records its mentions');
  end if;
  if coalesce((select p.is_test from public.profiles p where p.id = v_uid), false) then
    return jsonb_build_object('ok', true, 'sent', 0);
  end if;
  insert into public.notifications (user_id, type, payload)
  select p.id, 'note_mention', jsonb_build_object('case_id', n.case_id, 'note_id', n.id, 'author_id', v_uid)
    from public.profiles p
   where p.id = any (coalesce(p_user_ids, '{}'::uuid[])) and p.id <> v_uid and p.active and p.removed_at is null
     and not exists (select 1 from public.notifications x
                      where x.user_id = p.id and x.type = 'note_mention'
                        and x.payload ->> 'note_id' = n.id::text and x.created_at > now() - interval '1 hour');
  get diagnostics v_sent = row_count;
  return jsonb_build_object('ok', true, 'sent', v_sent);
end $$;
revoke all on function public.case_note_mention(uuid, uuid[]) from public, anon;
grant execute on function public.case_note_mention(uuid, uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Catalog
-- ---------------------------------------------------------------------------
insert into public.permission_catalog (action, kind, area, rule, enforcing_object, test_id, matrix, sort_order) values
  ('edit', 'case_note', 'Create or edit a case note', 'Case access on a live, non-archived case; edit your own note, command edits any; restrict-to-command is set by command only. History follows the note (record_versions).', 'case_notes_ins / case_notes_upd', 'v185a', '{"owner":"✓","command":"✓","member":"own notes","inactive":"✗"}', 34),
  ('read', 'case_note', 'Read a case note', 'Whoever can read the case; a note restricted to command is invisible to non-command readers (the author still sees their own).', 'case_notes_sel', 'v185a', '{"owner":"✓","command":"✓","member":"unrestricted only","inactive":"✗"}', 35)
on conflict (action, kind) do update set area = excluded.area, rule = excluded.rule,
  enforcing_object = excluded.enforcing_object, test_id = excluded.test_id, matrix = excluded.matrix, sort_order = excluded.sort_order;

-- ============================================================================
-- Rollback: drop public.case_note_mention; drop trigger cases_block_notes_column
-- and private.block_case_notes_column; drop table public.case_notes (the
-- legacy text still lives in cases.notes); delete the two catalog rows.
-- ============================================================================
