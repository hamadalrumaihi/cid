-- ============================================================================
-- 20261029120000_report_review.sql
-- Phase 5 (P5-03 review flow and required fields, P5-04 report_entities,
--          P5-07 report exports; RB4 task waive) — report_submit /
-- report_review / report_finalize / report_reopen, report_entities +
-- report_entities_set, report_exports + report_record_export,
-- case_task_waive / unwaive, the notifications, the widened client-facing
-- trigger, the perm_dispatch arms and the catalog rows.
--
-- APPLICATION NOTE: applied live to project jhxuflzmqspidkvjckox as
-- migration `report_review` (Supabase MCP). Additive: new tables (ON DELETE
-- CASCADE from reports so the legacy direct delete keeps working), new
-- nullable case_tasks columns, CREATE OR REPLACE functions; the old
-- report_reopen(uuid) signature is dropped (a reason is now required);
-- private.perm_dispatch is re-emitted with two new arms and every other arm
-- byte-identical to 20261026120000; private.version_protected_columns and
-- private.block_direct_report_finalize are re-emitted with the new columns.
-- public.report_entities_set was re-applied live as report_review_entity_exists
-- (the registry kinds check existence through private.soft_delete_state as
-- well as visibility) after the rolled-back verification run.
--
-- Contract (scratch p5_contract.md §2): the report RPCs keep the existing
-- style — they return the reports row and RAISE on refusal, with
-- private.perm_deny written first on authority refusals; report_entities_set,
-- report_record_export return jsonb {ok, …} / {ok:false, code:'denied', message}.
--
-- After the read-only security review the following were re-applied live as
-- report_review_fixes, byte-identical to this file: the client-facing trigger
-- now also guards INSERT (no sealed / reviewed / foreign-author row can be
-- forged) and freezes author_id / template / case_id / kind / seq / parent_id;
-- report_seal_checks requires the pinned version to be a published-or-
-- superseded version OF the report's template; report_reviewers never tells
-- anyone outside an SIU case's compartment; re_sel hides a media entity whose
-- media row the reader cannot see; report_finalize is author-only;
-- report_signature reads the badge from the profile; report_reopen needs a
-- writable case; can_waive_task is bureau-scoped like can_reopen_report;
-- report_record_export mints a random receipt code; report_entities_set caps
-- the snapshot size.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.report_entities (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  kind text not null check (kind in ('person', 'vehicle', 'gang', 'place', 'evidence', 'media',
                                     'officer', 'charge', 'legal_request', 'case', 'timeline_event')),
  ref_id uuid,
  role text,
  label text not null,
  snapshot jsonb not null default '{}'::jsonb,
  edited boolean not null default false,
  inserted_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check ((kind = 'timeline_event') = (ref_id is null))
);
create index if not exists report_entities_report_id_idx on public.report_entities (report_id);
create index if not exists report_entities_ref_idx on public.report_entities (kind, ref_id) where ref_id is not null;
alter table public.report_entities enable row level security;
drop policy if exists re_sel on public.report_entities;
create policy re_sel on public.report_entities for select to authenticated
  using (exists (select 1 from public.reports r
                  where r.id = report_id
                    and (private.is_live(r.deleted_at) or private.is_owner())
                    and private.can_read_case(r.case_id))
         -- a media row the reader cannot see (restricted) stays hidden here too
         and (kind <> 'media' or exists (select 1 from public.media m where m.id = ref_id)));
revoke all on public.report_entities from public, anon, authenticated;
grant select on public.report_entities to authenticated;
grant all on public.report_entities to service_role;

create table if not exists public.report_exports (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  version_number integer,
  format text not null check (format in ('pdf', 'docx', 'md')),
  verification_code text not null,
  exported_by uuid references public.profiles(id),
  exported_at timestamptz not null default now()
);
create index if not exists report_exports_report_id_idx on public.report_exports (report_id);
alter table public.report_exports enable row level security;
drop policy if exists rex_sel on public.report_exports;
create policy rex_sel on public.report_exports for select to authenticated
  using (exists (select 1 from public.reports r
                  where r.id = report_id
                    and (private.is_live(r.deleted_at) or private.is_owner())
                    and private.can_read_case(r.case_id)));
revoke all on public.report_exports from public, anon, authenticated;
grant select on public.report_exports to authenticated;
grant all on public.report_exports to service_role;
drop trigger if exists report_exports_immutable on public.report_exports;
create trigger report_exports_immutable before update or delete on public.report_exports
  for each row execute function private.block_legal_immutable();

alter table public.case_tasks add column if not exists waived_at timestamptz;
alter table public.case_tasks add column if not exists waived_by uuid references public.profiles(id);
alter table public.case_tasks add column if not exists waive_reason text;

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
-- Purpose:        who reviews a submitted report: active, case access, NOT
--                 the author, Senior Detective or above (Bureau Lead, Deputy
--                 Director, Director) or the Owner.
create or replace function private.can_review_report(p_report uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.reports r
      join public.profiles p on p.id = p_user
     where r.id = p_report and r.deleted_at is null
       and r.author_id is distinct from p_user
       and p_user = (select auth.uid())
       and p.removed_at is null
       and (coalesce(p.is_owner, false)
            or (p.active and p.role in ('senior_detective', 'bureau_lead', 'deputy_director', 'director')))
       and private.can_access_case(r.case_id))
$$;
revoke all on function private.can_review_report(uuid, uuid) from public, anon, authenticated;

-- Purpose:        who reopens a sealed report: a Bureau Lead over the case's
--                 bureau (JTF: any), Deputy Director+, the Owner.
create or replace function private.can_reopen_report(p_report uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.reports r
      join public.cases c on c.id = r.case_id
      join public.profiles p on p.id = p_user
     where r.id = p_report and r.deleted_at is null and r.finalized
       and p_user = (select auth.uid())
       and p.removed_at is null
       and (coalesce(p.is_owner, false)
            or (p.active and p.role in ('deputy_director', 'director'))
            or (p.active and p.role = 'bureau_lead' and (c.bureau = 'JTF' or c.bureau = p.division))))
$$;
revoke all on function private.can_reopen_report(uuid, uuid) from public, anon, authenticated;

-- Purpose:        the reviewers a submission is announced to: Bureau Leads of
--                 the case bureau (JTF: any Lead), Deputy Directors and
--                 Directors, and Senior Detectives assigned to the case;
--                 never the author.
create or replace function private.report_reviewers(p_case uuid, p_exclude uuid)
returns uuid[] language sql stable security definer set search_path to '' as $$
  select coalesce(array_agg(distinct p.id), '{}'::uuid[])
    from public.profiles p
    join public.cases c on c.id = p_case
   where p.active and p.removed_at is null and p.id is distinct from p_exclude
     -- an SIU case tells only the people inside its compartment
     and (not private.is_siu_case(p_case) or private.siu_in_compartment(p_case, p.id))
     and (p.role in ('deputy_director', 'director')
          or (p.role = 'bureau_lead' and (c.bureau = 'JTF' or c.bureau = p.division))
          or (p.role = 'senior_detective'
              and (c.lead_detective_id = p.id
                   or exists (select 1 from public.case_assignments a
                               where a.case_id = p_case and a.officer_id = p.id and a.removed_at is null))))
$$;
revoke all on function private.report_reviewers(uuid, uuid) from public, anon, authenticated;

-- Purpose:        a report notification. Test-actor → real-target is
--                 suppressed as in private.legal_notify.
create or replace function private.report_notify(p_user uuid, p_report uuid, p_kind text, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare r public.reports; v_actor uuid := (select auth.uid()); v_actor_name text;
        v_actor_test boolean; v_target_test boolean; v_case_number text; v_title text;
begin
  if p_user is null or p_user = v_actor then return; end if;
  select * into r from public.reports where id = p_report;
  if not found then return; end if;
  select private.is_test_user(v_actor) or exists (select 1 from auth.users u where u.id = v_actor and u.email like 'rls-test-%@cidportal.test') into v_actor_test;
  select private.is_test_user(p_user) or exists (select 1 from auth.users u where u.id = p_user and u.email like 'rls-test-%@cidportal.test') into v_target_test;
  if coalesce(v_actor_test, false) and not coalesce(v_target_test, false) then return; end if;
  select display_name into v_actor_name from public.profiles where id = v_actor;
  select case_number into v_case_number from public.cases where id = r.case_id;
  select t.name into v_title from public.report_templates t where t.key = r.template;
  insert into public.notifications (user_id, type, payload)
  values (p_user, p_kind, jsonb_build_object(
    'report_id', p_report, 'case_id', r.case_id, 'case_number', v_case_number,
    'template', r.template, 'title', coalesce(v_title, r.template),
    'reason', left(p_reason, 500), 'actor_id', v_actor, 'actor_name', v_actor_name));
end $$;
revoke all on function private.report_notify(uuid, uuid, text, text) from public, anon, authenticated;

-- Purpose:        the labels of the required keys a report's fields do not
--                 satisfy — a non-blank string, a non-empty array, or a grid
--                 with at least one row satisfies a key.
create or replace function private.report_required_gaps(p_schema jsonb, p_required text[], p_fields jsonb)
returns text[] language plpgsql immutable set search_path to '' as $$
declare k text; v jsonb; v_out text[] := '{}'; v_label text; s jsonb; f jsonb;
begin
  foreach k in array coalesce(p_required, '{}'::text[]) loop
    v := coalesce(p_fields, '{}'::jsonb) -> k;
    if v is null or jsonb_typeof(v) = 'null'
       or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '')
       or (jsonb_typeof(v) = 'array' and jsonb_array_length(v) = 0) then
      v_label := null;
      for s in select * from jsonb_array_elements(coalesce(p_schema->'sections', '[]'::jsonb)) loop
        if s->>'type' = 'kv' then
          for f in select * from jsonb_array_elements(s->'fields') loop
            if f->>'key' = k then v_label := f->>'label'; end if;
          end loop;
        elsif s->>'type' = 'textarea' and s->>'key' = k then v_label := s->>'label';
        elsif s->>'type' = 'grid' and s->>'id' = k then v_label := s->>'label';
        end if;
      end loop;
      v_out := v_out || coalesce(v_label, k);
    end if;
  end loop;
  return v_out;
end $$;
revoke all on function private.report_required_gaps(jsonb, text[], jsonb) from public, anon, authenticated;

create or replace function private.case_open_task_count(p_case uuid)
returns integer language sql stable security definer set search_path to '' as $$
  select count(*)::integer from public.case_tasks t
   where t.case_id = p_case and t.deleted_at is null and not t.done and t.waived_at is null
$$;
revoke all on function private.case_open_task_count(uuid) from public, anon, authenticated;

-- Purpose:        the checks every seal path shares (submit, self-seal,
--                 finalize): a pinned published-or-superseded version, the
--                 required keys, the closure gate. Returns the version row.
create or replace function private.report_seal_checks(r public.reports)
returns public.report_template_versions language plpgsql stable security definer set search_path to '' as $$
declare v public.report_template_versions; v_gaps text[]; v_open integer;
begin
  if r.template_version_id is null then
    raise exception 'this report has no published template — pick a template';
  end if;
  select * into v from public.report_template_versions where id = r.template_version_id;
  if v.status not in ('published', 'superseded')
     or v.template_id is distinct from (select t.id from public.report_templates t where t.key = r.template) then
    raise exception 'this report is pinned to a version that is not a published version of its template';
  end if;
  v_gaps := private.report_required_gaps(v.schema, v.required, r.fields);
  if coalesce(array_length(v_gaps, 1), 0) > 0 then
    raise exception 'required fields missing: %', array_to_string(v_gaps, ', ');
  end if;
  if r.template = 'case_closure' then
    v_open := private.case_open_task_count(r.case_id);
    if v_open > 0 then
      raise exception '% open task(s) must be done or waived before closure', v_open;
    end if;
  end if;
  return v;
end $$;
revoke all on function private.report_seal_checks(public.reports) from public, anon, authenticated;

create or replace function private.report_signature(p_user uuid, p_badge text, p_typed text, p_role text)
returns jsonb language sql stable security definer set search_path to '' as $$
  select jsonb_build_object(
    'officer', coalesce(p.display_name, 'Officer'),
    'signer_id', p_user,
    'badge', coalesce(nullif(btrim(coalesce(p.badge_number, '')), ''), nullif(btrim(coalesce(p_badge, '')), '')),
    'signed_at', now(),
    'typed', coalesce(nullif(btrim(coalesce(p_typed, '')), ''), p.display_name, 'Officer'))
    || case when p_role is null then '{}'::jsonb else jsonb_build_object('role', p_role) end
  from public.profiles p where p.id = p_user
$$;
revoke all on function private.report_signature(uuid, text, text, text) from public, anon, authenticated;

-- Purpose:        the one seal: finalized, approved, the version row, the
--                 audit row and the notification. p_self = no reviewer.
create or replace function private.report_seal(p_report uuid, p_author_sig jsonb, p_reviewer_sig jsonb, p_self boolean)
returns public.reports language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.reports; v_num integer; v_lead uuid;
begin
  update public.reports
     set finalized = true,
         review_status = 'approved',
         signature = coalesce(p_author_sig, signature),
         reviewer_signature = p_reviewer_sig,
         reviewed_by = case when p_self then reviewed_by else v_uid end,
         reviewed_at = case when p_self then reviewed_at else now() end,
         updated_at = now()
   where id = p_report returning * into r;
  select coalesce(max(version_number), 0) + 1 into v_num from public.report_versions where report_id = p_report;
  insert into public.report_versions (report_id, version_number, fields, signature, reviewer_signature, created_by)
  values (p_report, v_num, r.fields, r.signature, r.reviewer_signature, v_uid);
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'REPORT_FINALIZED', 'reports', p_report,
          jsonb_build_object('case_id', r.case_id, 'template', r.template, 'version_number', v_num,
                             'self_sealed', p_self, 'template_version_id', r.template_version_id));
  if p_self then
    select lead_detective_id into v_lead from public.cases where id = r.case_id;
    perform private.report_notify(v_lead, p_report, 'report_finalized',
      'A ' || coalesce((select name from public.report_templates where key = r.template), r.template) || ' was sealed on your case.');
  else
    perform private.report_notify(r.author_id, p_report, 'report_finalized', 'Your report was approved and sealed.');
  end if;
  return r;
end $$;
revoke all on function private.report_seal(uuid, jsonb, jsonb, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The flow
-- ---------------------------------------------------------------------------
create or replace function public.report_submit(p_report uuid, p_signature text default null, p_badge text default null)
returns public.reports language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.reports; v public.report_template_versions;
        v_sig jsonb; u uuid; v_n integer := 0;
begin
  select * into r from public.reports where id = p_report for update;
  if not found or r.deleted_at is not null then raise exception 'report not found'; end if;
  if r.author_id is distinct from v_uid then
    perform private.perm_deny('submit', 'report', p_report, 'not_author');
    raise exception 'only the report''s author may submit it';
  end if;
  if r.finalized then raise exception 'report already sealed'; end if;
  if r.review_status not in ('draft', 'returned') then raise exception 'report is already awaiting review'; end if;
  if not (private.is_active() and private.case_writable(r.case_id)) then
    perform private.perm_deny('submit', 'report', p_report, 'case_not_writable');
    raise exception 'this case is not writable (no access, archived or deleted)';
  end if;
  v := private.report_seal_checks(r);
  v_sig := private.report_signature(v_uid, p_badge, p_signature, null);
  if v.review_required then
    update public.reports
       set review_status = 'submitted', submitted_at = now(), submitted_by = v_uid,
           signature = v_sig, review_note = null, reviewed_by = null, reviewed_at = null,
           reviewer_signature = null, updated_at = now()
     where id = p_report returning * into r;
    insert into public.audit_log (actor_id, action, entity, entity_id, detail)
    values (v_uid, 'REPORT_SUBMITTED', 'reports', p_report,
            jsonb_build_object('case_id', r.case_id, 'template', r.template, 'template_version_id', r.template_version_id));
    foreach u in array private.report_reviewers(r.case_id, v_uid) loop
      v_n := v_n + 1;
      perform private.report_notify(u, p_report, 'report_submitted',
        'A ' || coalesce(v.schema->>'title', r.template) || ' awaits your review.');
    end loop;
    if v_n = 0 then
      insert into public.audit_log (actor_id, action, entity, entity_id, detail)
      values (v_uid, 'REPORT_REVIEW_UNCOVERED', 'reports', p_report, jsonb_build_object('case_id', r.case_id));
    end if;
    return r;
  end if;
  return private.report_seal(p_report, v_sig, null, true);
end $$;

create or replace function public.report_review(p_report uuid, p_decision text, p_note text default null,
  p_signature text default null, p_badge text default null)
returns public.reports language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.reports; v_sig jsonb;
        v_role text; v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 2000);
begin
  if p_decision not in ('approve', 'return') then raise exception 'decision must be approve or return'; end if;
  select * into r from public.reports where id = p_report for update;
  if not found or r.deleted_at is not null then raise exception 'report not found'; end if;
  if r.review_status <> 'submitted' then raise exception 'report is not awaiting review'; end if;
  if not private.can_review_report(p_report, v_uid) then
    perform private.perm_deny('review', 'report', p_report,
      case when r.author_id = v_uid then 'own_report' else 'not_reviewer' end);
    raise exception 'only a Senior Detective or above with access to the case, and never the author, may review this report';
  end if;
  if p_decision = 'return' then
    if v_note is null then raise exception 'a note is required to return a report'; end if;
    update public.reports
       set review_status = 'returned', review_note = v_note, reviewed_by = v_uid, reviewed_at = now(),
           updated_at = now()
     where id = p_report returning * into r;
    insert into public.audit_log (actor_id, action, entity, entity_id, detail)
    values (v_uid, 'REPORT_RETURNED', 'reports', p_report,
            jsonb_build_object('case_id', r.case_id, 'note', left(v_note, 300)));
    perform private.report_notify(r.author_id, p_report, 'report_returned', v_note);
    return r;
  end if;
  perform private.report_seal_checks(r);
  select role::text into v_role from public.profiles where id = v_uid;
  v_sig := private.report_signature(v_uid, p_badge, p_signature, v_role);
  update public.reports set review_note = v_note where id = p_report;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'REPORT_APPROVED', 'reports', p_report,
          jsonb_build_object('case_id', r.case_id, 'note', left(coalesce(v_note, ''), 300)));
  return private.report_seal(p_report, null, v_sig, false);
end $$;

-- Purpose:        the legacy seal: only a self-seal template (review_required
--                 = false) may be finalized directly; everything else is
--                 submitted for review.
create or replace function public.report_finalize(p_report uuid, p_badge text default null)
returns public.reports language plpgsql security definer set search_path to '' as $$
declare r public.reports; v_uid uuid := (select auth.uid()); v public.report_template_versions;
begin
  select * into r from public.reports where id = p_report for update;
  if not found or r.deleted_at is not null then raise exception 'report not found'; end if;
  if r.finalized then raise exception 'report already finalized'; end if;
  if r.author_id is distinct from v_uid then
    perform private.perm_deny('submit', 'report', p_report, 'not_author');
    raise exception 'only the report''s author may finalize it';
  end if;
  if not (private.is_active() and private.can_access_case(r.case_id)) then
    perform private.perm_deny('submit', 'report', p_report, 'no_case_access');
    raise exception 'not permitted to finalize this report'; end if;
  if not private.case_writable(r.case_id) then
    raise exception 'this case is archived — restore it before finalizing a report'; end if;
  v := private.report_seal_checks(r);
  if v.review_required then
    raise exception 'this template requires review — submit the report for review';
  end if;
  return private.report_seal(p_report, private.report_signature(v_uid, p_badge, null, null), null, true);
end $$;

drop function if exists public.report_reopen(uuid);
create or replace function public.report_reopen(p_report uuid, p_reason text default null)
returns public.reports language plpgsql security definer set search_path to '' as $$
declare r public.reports; v_uid uuid := (select auth.uid());
        v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 500);
begin
  select * into r from public.reports where id = p_report for update;
  if not found or r.deleted_at is not null then raise exception 'report not found'; end if;
  if v_reason is null then raise exception 'a reason is required to reopen a sealed report'; end if;
  if not r.finalized then raise exception 'report is not finalized'; end if;
  if not private.can_reopen_report(p_report, v_uid) then
    perform private.perm_deny('reopen', 'report', p_report, 'not_authority');
    raise exception 'only a Bureau Lead over this bureau, a Deputy Director, a Director or the Owner may reopen a sealed report';
  end if;
  if not private.case_writable(r.case_id) then
    raise exception 'this case is archived — restore it before reopening a report';
  end if;
  update public.reports
     set finalized = false,
         review_status = 'draft',
         signature = null, reviewer_signature = null,
         reviewed_by = null, reviewed_at = null, review_note = null,
         submitted_at = null, submitted_by = null,
         fields = coalesce(fields, '{}'::jsonb) || jsonb_build_object(
           '_reopen_log',
           coalesce(fields->'_reopen_log', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
             'at', now(), 'by', v_uid, 'reason', v_reason,
             'prev_signature', signature, 'prev_reviewer_signature', reviewer_signature))),
         updated_at = now()
   where id = p_report
  returning * into r;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'REPORT_REOPENED', 'reports', p_report,
          jsonb_build_object('case_id', r.case_id, 'reason', v_reason));
  perform private.report_notify(r.author_id, p_report, 'report_reopened', v_reason);
  return r;
end $$;

revoke all on function public.report_submit(uuid, text, text) from public, anon;
revoke all on function public.report_review(uuid, text, text, text, text) from public, anon;
revoke all on function public.report_reopen(uuid, text) from public, anon;
grant execute on function public.report_submit(uuid, text, text) to authenticated;
grant execute on function public.report_review(uuid, text, text, text, text) to authenticated;
grant execute on function public.report_reopen(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Entities and exports
-- ---------------------------------------------------------------------------
create or replace function private.report_denied(p_action text, p_report uuid, p_reason text, p_message text)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  perform private.perm_deny(p_action, 'report', p_report, p_reason);
  return jsonb_build_object('ok', false, 'code', 'denied', 'message', p_message);
end $$;
revoke all on function private.report_denied(text, uuid, text, text) from public, anon, authenticated;

-- Purpose:        REPLACE the report's inserted-record set. Every reference
--                 must exist and be readable by the caller; the source row
--                 is never written.
create or replace function public.report_entities_set(p_report uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.reports; x jsonb; v_kind text; v_ref uuid;
        v_n integer := 0; v_ok boolean; v_label text;
begin
  select * into r from public.reports where id = p_report for update;
  if not found or r.deleted_at is not null then raise exception 'report not found'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'p_items must be an array'; end if;
  if r.finalized or r.review_status not in ('draft', 'returned') then
    return private.report_denied('edit', p_report, 'locked', 'a submitted or sealed report''s contents are locked');
  end if;
  if not (private.is_active() and private.case_writable(r.case_id)
          and (r.author_id = v_uid or private.can_access_case(r.case_id))) then
    return private.report_denied('edit', p_report, 'case_not_writable',
      'this case is not writable (no access, archived or deleted)');
  end if;
  delete from public.report_entities where report_id = p_report;
  for x in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(x) <> 'object' then raise exception 'each item must be an object'; end if;
    v_kind := x->>'kind';
    v_label := left(btrim(coalesce(x->>'label', '')), 300);
    if v_label = '' then raise exception 'each item needs a label'; end if;
    v_ref := nullif(btrim(coalesce(x->>'ref_id', '')), '')::uuid;
    if length(coalesce(x->'snapshot', '{}'::jsonb)::text) > 8000 then raise exception 'snapshot too large (8 KB limit)'; end if;
    if v_kind = 'timeline_event' then
      if v_ref is not null then raise exception 'a timeline event carries no ref_id'; end if;
      v_ok := true;
    elsif v_ref is null then
      raise exception '% needs a ref_id', coalesce(v_kind, 'item');
    elsif v_kind in ('person', 'vehicle', 'gang', 'place', 'evidence', 'media') then
      -- visibility alone says nothing about a made-up id: the record must exist and be live too.
      select st.p_exists and st.p_deleted_at is null and private.perm_registry_visible(v_kind, v_ref)
        into v_ok from private.soft_delete_state(v_kind, v_ref) st;
    elsif v_kind = 'officer' then
      v_ok := exists (select 1 from public.profiles p where p.id = v_ref);
    elsif v_kind = 'charge' then
      v_ok := exists (select 1 from public.case_charges cc where cc.id = v_ref and cc.case_id = r.case_id);
    elsif v_kind = 'legal_request' then
      v_ok := private.can_view_legal_request(v_ref, v_uid);
    elsif v_kind = 'case' then
      v_ok := exists (select 1 from public.cases c where c.id = v_ref and c.deleted_at is null) and private.can_read_case(v_ref);
    else
      raise exception 'unknown entity kind %', coalesce(v_kind, '(none)');
    end if;
    if not coalesce(v_ok, false) then
      raise exception '% % not found or not accessible', v_kind, v_ref;
    end if;
    insert into public.report_entities (report_id, kind, ref_id, role, label, snapshot, edited, inserted_by)
    values (p_report, v_kind, v_ref, left(nullif(btrim(coalesce(x->>'role', '')), ''), 40), v_label,
            case when jsonb_typeof(x->'snapshot') = 'object' then x->'snapshot' else '{}'::jsonb end,
            coalesce((x->>'edited')::boolean, false), v_uid);
    v_n := v_n + 1;
  end loop;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'REPORT_ENTITIES_SET', 'reports', p_report, jsonb_build_object('count', v_n));
  return jsonb_build_object('ok', true, 'count', v_n);
end $$;

create or replace function public.report_record_export(p_report uuid, p_format text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.reports; v_num integer; v_code text; v_id uuid;
begin
  select * into r from public.reports where id = p_report;
  if not found then raise exception 'report not found'; end if;
  if p_format not in ('pdf', 'docx', 'md') then raise exception 'format must be pdf, docx or md'; end if;
  if not ((r.deleted_at is null or private.is_owner()) and private.can_read_case(r.case_id)) then
    return private.report_denied('export', p_report, 'not_visible', 'not authorized to export this report');
  end if;
  select max(version_number) into v_num from public.report_versions where report_id = p_report;
  -- a receipt, not a hash: minted per export, so a code proves an export was recorded
  v_code := upper(left(md5(gen_random_uuid()::text || p_report::text), 10));
  insert into public.report_exports (report_id, version_number, format, verification_code, exported_by)
  values (p_report, v_num, p_format, v_code, v_uid) returning id into v_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'REPORT_EXPORTED', 'reports', p_report,
          jsonb_build_object('export_id', v_id, 'format', p_format, 'version_number', v_num,
                             'verification_code', v_code, 'sealed', r.finalized));
  return jsonb_build_object('ok', true, 'id', v_id, 'version_number', v_num, 'verification_code', v_code);
end $$;

revoke all on function public.report_entities_set(uuid, jsonb) from public, anon;
revoke all on function public.report_record_export(uuid, text) from public, anon;
grant execute on function public.report_entities_set(uuid, jsonb) to authenticated;
grant execute on function public.report_record_export(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Task waive (RB4) — the case lead, command (Bureau Lead+) or the Owner
-- ---------------------------------------------------------------------------
create or replace function private.can_waive_task(p_case uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select private.case_writable(p_case)
     and exists (
       select 1 from public.cases c join public.profiles p on p.id = p_user
        where c.id = p_case and p.removed_at is null
          and (coalesce(p.is_owner, false)
               or c.lead_detective_id = p_user
               or (p.active and p.role in ('deputy_director', 'director'))
               or (p.active and p.role = 'bureau_lead' and (c.bureau = 'JTF' or c.bureau = p.division))))
$$;
revoke all on function private.can_waive_task(uuid, uuid) from public, anon, authenticated;

create or replace function public.case_task_waive(p_task uuid, p_reason text)
returns public.case_tasks language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); t public.case_tasks;
        v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 500);
begin
  select * into t from public.case_tasks where id = p_task for update;
  if not found or t.deleted_at is not null then raise exception 'task not found'; end if;
  if v_reason is null then raise exception 'a reason is required to waive a task'; end if;
  if not private.can_waive_task(t.case_id, v_uid) then
    perform private.perm_deny('waive', 'case_task', p_task, 'not_authority');
    raise exception 'only the case lead, command or the Owner may waive a task';
  end if;
  if t.done then raise exception 'a completed task does not need waiving'; end if;
  update public.case_tasks set waived_at = now(), waived_by = v_uid, waive_reason = v_reason
   where id = p_task returning * into t;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'TASK_WAIVED', 'case_tasks', p_task, jsonb_build_object('case_id', t.case_id, 'reason', v_reason));
  return t;
end $$;

create or replace function public.case_task_unwaive(p_task uuid)
returns public.case_tasks language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); t public.case_tasks;
begin
  select * into t from public.case_tasks where id = p_task for update;
  if not found or t.deleted_at is not null then raise exception 'task not found'; end if;
  if not private.can_waive_task(t.case_id, v_uid) then
    perform private.perm_deny('waive', 'case_task', p_task, 'not_authority');
    raise exception 'only the case lead, command or the Owner may restore a waived task';
  end if;
  if t.waived_at is null then return t; end if;
  update public.case_tasks set waived_at = null, waived_by = null, waive_reason = null
   where id = p_task returning * into t;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'TASK_UNWAIVED', 'case_tasks', p_task, jsonb_build_object('case_id', t.case_id));
  return t;
end $$;
revoke all on function public.case_task_waive(uuid, text) from public, anon;
revoke all on function public.case_task_unwaive(uuid) from public, anon;
grant execute on function public.case_task_waive(uuid, text) to authenticated;
grant execute on function public.case_task_unwaive(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Locks — the client-facing trigger and the versioning protected list
-- ---------------------------------------------------------------------------
create or replace function private.block_direct_report_finalize()
returns trigger language plpgsql set search_path to '' as $$
begin
  if current_user not in ('authenticated','anon') then return new; end if;
  if tg_op = 'INSERT' then
    -- A direct insert is a plain draft by its author on the template's
    -- published version — nothing sealed, reviewed or foreign can be forged.
    if new.finalized or new.review_status <> 'draft'
       or new.signature is not null or new.reviewer_signature is not null
       or new.submitted_at is not null or new.submitted_by is not null
       or new.reviewed_by is not null or new.reviewed_at is not null or new.review_note is not null then
      raise exception 'a report is created as a draft — the review state only changes through report_submit / report_review';
    end if;
    if new.author_id is distinct from (select auth.uid()) then
      raise exception 'a report''s author is the account that creates it';
    end if;
    if new.template_version_id is not null and new.template_version_id is distinct from (
         select v.id from public.report_templates t
           join public.report_template_versions v on v.template_id = t.id and v.status = 'published'
          where t.key = new.template and t.active) then
      raise exception 'a report pins the published version of its template';
    end if;
    return new;
  end if;
  -- UPDATE: identity and review state are fixed; contents lock once submitted.
  if new.author_id is distinct from old.author_id or new.template is distinct from old.template
     or new.case_id is distinct from old.case_id or new.kind is distinct from old.kind
     or new.seq is distinct from old.seq or new.parent_id is distinct from old.parent_id then
    raise exception 'a report''s author, template, case, kind, sequence and parent are fixed';
  end if;
  if new.finalized is distinct from old.finalized
     or new.signature is distinct from old.signature
     or new.reviewer_signature is distinct from old.reviewer_signature
     or new.review_status is distinct from old.review_status
     or new.submitted_at is distinct from old.submitted_at
     or new.submitted_by is distinct from old.submitted_by
     or new.reviewed_by is distinct from old.reviewed_by
     or new.reviewed_at is distinct from old.reviewed_at
     or new.review_note is distinct from old.review_note
     or new.template_version_id is distinct from old.template_version_id then
    raise exception 'the review state of a report only changes through report_submit / report_review / report_finalize / report_reopen';
  end if;
  if old.finalized
     and coalesce(new.fields, '{}'::jsonb) is distinct from coalesce(old.fields, '{}'::jsonb) then
    raise exception 'a finalized report''s contents are locked (use warrant_set_status() for the warrant lifecycle)';
  end if;
  if not old.finalized and old.review_status in ('submitted', 'approved')
     and coalesce(new.fields, '{}'::jsonb) is distinct from coalesce(old.fields, '{}'::jsonb) then
    raise exception 'a submitted report''s contents are locked until it is returned';
  end if;
  return new;
end $$;
drop trigger if exists trg_block_direct_report_finalize on public.reports;
create trigger trg_block_direct_report_finalize before insert or update on public.reports
  for each row execute function private.block_direct_report_finalize();

create or replace function private.block_direct_task_waive()
returns trigger language plpgsql set search_path to '' as $$
begin
  if current_user in ('authenticated','anon')
     and (new.waived_at is distinct from old.waived_at
          or new.waived_by is distinct from old.waived_by
          or new.waive_reason is distinct from old.waive_reason) then
    raise exception 'a task is waived through case_task_waive()';
  end if;
  return new;
end $$;
drop trigger if exists case_tasks_block_direct_waive on public.case_tasks;
create trigger case_tasks_block_direct_waive before update on public.case_tasks
  for each row execute function private.block_direct_task_waive();

create or replace function private.version_protected_columns(p_table text)
returns text[] language sql immutable set search_path to '' as $$
  select array['id', 'created_at', 'created_by', 'updated_at', 'archived_at', 'archived_by',
               'deleted_at', 'deleted_by', 'delete_reason', 'delete_batch', 'last_stale_notified_at']
      || case p_table
           when 'cases' then array['bureau', 'case_number', 'case_authority', 'status', 'closed_at',
                                   'lead_detective_id', 'is_joint_case', 'originating_bureau']
           when 'reports' then array['case_id', 'author_id', 'finalized', 'signature', 'seq', 'kind',
                                     'parent_id', 'template', 'template_version_id', 'review_status',
                                     'submitted_at', 'submitted_by', 'reviewed_by', 'reviewed_at',
                                     'review_note', 'reviewer_signature']
           when 'evidence' then array['case_id', 'collected_by']
           when 'narcotics' then array['status']
           when 'field_submissions' then array['officer_id', 'status', 'submitted_at', 'assigned_to',
                                               'assigned_at', 'submission_no', 'archive_reason']
           when 'case_notes' then array['case_id', 'author_id', 'source']
           else '{}'::text[] end
$$;

-- ---------------------------------------------------------------------------
-- 7. private.perm_dispatch — two new arms; every other arm byte-identical
--    to 20261026120000.
-- ---------------------------------------------------------------------------
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
revoke all on function private.perm_dispatch(text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Catalog
-- ---------------------------------------------------------------------------
insert into public.permission_catalog (action, kind, area, rule, enforcing_object, test_id, matrix, sort_order) values
  ('submit', 'report', 'Submit a report for review', 'The author, while the report is a draft or returned, on a writable case; every required field of the pinned template version must be present (a closure report also needs every open task done or waived). A self-seal template seals on submit.', 'public.report_submit', 'v187b', '{"owner":"author","command":"author","member":"author","inactive":"✗"}', 330),
  ('review', 'report', 'Review a submitted report', 'A Senior Detective or above with access to the case, never the author; approve seals with both signatures, return needs a note.', 'public.report_review → private.can_review_report', 'v187b', '{"owner":"✓","command":"case access","member":"SrDet on the case","inactive":"✗"}', 340),
  ('reopen', 'report', 'Reopen a sealed report', 'A Bureau Lead over the case''s bureau (JTF: any), a Deputy Director, a Director or the Owner, with a reason; the author is told.', 'public.report_reopen → private.can_reopen_report', 'v187b', '{"owner":"✓","command":"own bureau / DD+","member":"✗","inactive":"✗"}', 350),
  ('export', 'report', 'Export a report (PDF / DOCX / MD)', 'Whoever can read the report; every export is logged with a verification code.', 'public.report_record_export', 'v187c', '{"owner":"✓","command":"read access","member":"read access","inactive":"✗"}', 360),
  ('propose', 'report_template', 'Propose a report template version', 'A Bureau Lead or above (or the Owner) drafts a version of an existing template; a Director publishes it.', 'public.report_template_save → private.report_template_proposer', 'v187a', '{"owner":"✓","command":"✓","member":"✗","inactive":"✗"}', 370),
  ('publish', 'report_template', 'Publish, retire or create a report template', 'A Director, Deputy Director or the Owner; publishing supersedes the previous version, existing reports keep the version they pinned.', 'public.report_template_publish / _update → private.report_template_admin', 'v187a', '{"owner":"✓","command":"DD / Director","member":"✗","inactive":"✗"}', 380)
on conflict (action, kind) do update set area = excluded.area, rule = excluded.rule,
  enforcing_object = excluded.enforcing_object, test_id = excluded.test_id, matrix = excluded.matrix, sort_order = excluded.sort_order;

-- ============================================================================
-- Rollback: drop the two tables and the three case_tasks columns; drop the
-- new public / private functions; re-create report_reopen(uuid),
-- report_finalize, block_direct_report_finalize, version_protected_columns
-- and perm_dispatch from their previous states; delete the six catalog rows.
-- ============================================================================
