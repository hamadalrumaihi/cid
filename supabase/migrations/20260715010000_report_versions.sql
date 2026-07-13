-- Report finalize snapshots (v1.14 consistency release, adopting the legal
-- immutable-version pattern for CID reports — DOJ-INTEGRATION adoption
-- register item "Immutable-version display → report versioning").
--
-- Every report_finalize() now freezes the sealed content + signature into
-- report_versions: seal v1, reopen, edit, seal again → v2, with v1 still
-- readable. Unlike legal records, reports remain client-deletable
-- (deleteWithUndo), so versions CASCADE with their report instead of
-- restricting deletion; immutability means no UPDATEs ever (trigger), and
-- clients get no write grants at all — the amended definer RPC is the only
-- writer.

create table public.report_versions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  version_number integer not null,
  fields jsonb not null,
  signature jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (report_id, version_number)
);
alter table public.report_versions enable row level security;

-- Read follows the report's case access; writes are definer-RPC only.
create policy report_versions_sel on public.report_versions
  for select to authenticated
  using (exists (select 1 from public.reports r
                 where r.id = report_id and private.can_access_case(r.case_id)));
revoke insert, update, delete on table public.report_versions from authenticated, anon;

-- Immutable content: block client UPDATEs (DELETE stays open so the FK
-- cascade from a client report delete still works — current_user is the
-- caller inside cascaded row triggers, so a delete-block would break it).
create or replace function private.block_report_version_update()
returns trigger language plpgsql set search_path to '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    raise exception 'report versions are immutable';
  end if;
  return new;
end $$;
create trigger report_versions_immutable before update on public.report_versions
  for each row execute function private.block_report_version_update();

create index report_versions_report_idx on public.report_versions (report_id);

-- report_finalize: unchanged behavior + a version snapshot of exactly what
-- was sealed (fields at seal time + the fresh signature).
create or replace function public.report_finalize(p_report uuid, p_badge text default null::text)
returns public.reports
language plpgsql security definer set search_path to '' as $$
declare r public.reports; v_uid uuid := (select auth.uid()); v_name text; v_num integer;
begin
  select * into r from public.reports where id = p_report;
  if not found then raise exception 'report not found'; end if;
  if r.finalized then raise exception 'report already finalized'; end if;
  if not (private.is_active() and private.can_access_case(r.case_id)) then
    raise exception 'not permitted to finalize this report'; end if;
  select display_name into v_name from public.profiles where id = v_uid;
  update public.reports
    set finalized = true,
        signature = jsonb_build_object(
          'officer', coalesce(v_name, 'Officer'),
          'signer_id', v_uid,
          'badge', nullif(btrim(coalesce(p_badge,'')), ''),
          'signed_at', now()
        ),
        updated_at = now()
    where id = p_report returning * into r;
  select coalesce(max(version_number), 0) + 1 into v_num
    from public.report_versions where report_id = p_report;
  insert into public.report_versions (report_id, version_number, fields, signature, created_by)
  values (p_report, v_num, r.fields, r.signature, v_uid);
  return r;
end $$;
