-- ============================================================================
-- 20261031120000_intel_groups_convert.sql
-- Phase 6 (P6-03 groups, P6-04 extended claim links and convert-to-record,
--          P6-07 SIB referral cross-link, P6-08 catalog) — intel_groups /
-- intel_group_members / intel_group_cases with their RPCs and the suggestion,
-- field_claim_links widened to narcotic | account | indicator with the claim →
-- target pair rule, the provenance column on the six registries,
-- field_submission_convert, siu_referred_submissions, the field_submission
-- arm of private.perm_dispatch and the catalog rows.
--
-- APPLICATION NOTE: applied live to project jhxuflzmqspidkvjckox as
-- migration `intel_groups_convert` (Supabase MCP). Additive: three new tables,
-- four nullable columns on field_claim_links (claim_item_id; the one_claim and
-- one_target CHECKs widened),
-- one nullable column on persons / vehicles / gangs / places / accounts /
-- narcotics, CREATE OR REPLACE functions; field_claim_link,
-- field_submission_repeats and private.field_submission_dependencies are
-- re-emitted; private.perm_dispatch is re-emitted with one new arm and every
-- other arm byte-identical to 20261029120000. The EXECUTE grant on
-- private.intel_group_readable (a policy helper) was re-applied live as
-- intel_groups_convert_policy_grant after the rolled-back verification run, and
-- the security-review follow-up (repeat / suggestion labels masked to what the
-- reader may see, intel_group_cases readable only with case visibility, the
-- convert payload's enum fields validated with the RPC's own wording, a
-- non-manager's converted narcotic unidentified / unverified, perm_denied_ack
-- hardened) as intel_review_fixes.
--
-- Contract (scratch p6_contract.md §5–8): void RPCs RAISE with the existing
-- wording, authority refusals through private.perm_raise (P0403);
-- field_submission_convert, intel_group_suggest and intel_group_summary
-- return jsonb. A group never merges, deletes or edits a member.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Groups (P6-03)
-- ---------------------------------------------------------------------------
create table if not exists public.intel_groups (
  id uuid primary key default gen_random_uuid(),
  title text not null check (btrim(title) <> '' and length(title) <= 200),
  note text,
  lead_submission_id uuid not null references public.field_submissions(id) on delete cascade,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references public.profiles(id),
  close_reason text
);
create index if not exists intel_groups_lead_idx on public.intel_groups (lead_submission_id);

create table if not exists public.intel_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.intel_groups(id) on delete cascade,
  submission_id uuid not null references public.field_submissions(id) on delete cascade,
  added_by uuid references public.profiles(id),
  added_at timestamptz not null default now(),
  note text,
  removed_at timestamptz,
  removed_by uuid references public.profiles(id),
  remove_reason text,
  unique (group_id, submission_id)
);
create index if not exists intel_group_members_submission_idx on public.intel_group_members (submission_id);

create table if not exists public.intel_group_cases (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.intel_groups(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  linked_by uuid references public.profiles(id),
  linked_at timestamptz not null default now(),
  note text,
  unlinked_at timestamptz,
  unlinked_by uuid references public.profiles(id),
  unlink_reason text,
  unique (group_id, case_id)
);
create index if not exists intel_group_cases_case_idx on public.intel_group_cases (case_id);

-- Purpose:        a group is readable when its lead record is.
create or replace function private.intel_group_readable(p_group uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select private.is_active()
     and exists (select 1 from public.intel_groups g
                  where g.id = p_group and private.field_submission_readable(g.lead_submission_id))
$$;
-- Referenced by the three SELECT policies, so authenticated must be able to run it.
revoke all on function private.intel_group_readable(uuid) from public, anon;
grant execute on function private.intel_group_readable(uuid) to authenticated, service_role;

alter table public.intel_groups enable row level security;
alter table public.intel_group_members enable row level security;
alter table public.intel_group_cases enable row level security;

drop policy if exists ig_sel on public.intel_groups;
create policy ig_sel on public.intel_groups for select to authenticated
  using (private.is_active() and private.field_submission_readable(lead_submission_id));
drop policy if exists igm_sel on public.intel_group_members;
create policy igm_sel on public.intel_group_members for select to authenticated
  using (private.intel_group_readable(group_id) and private.field_submission_readable(submission_id));
drop policy if exists igc_sel on public.intel_group_cases;
create policy igc_sel on public.intel_group_cases for select to authenticated
  using (private.intel_group_readable(group_id) and private.field_case_visible(case_id));

revoke all on public.intel_groups, public.intel_group_members, public.intel_group_cases from public, anon, authenticated;
grant select on public.intel_groups, public.intel_group_members, public.intel_group_cases to authenticated;
grant all on public.intel_groups, public.intel_group_members, public.intel_group_cases to service_role;

drop trigger if exists intel_groups_audit on public.intel_groups;
create trigger intel_groups_audit after insert or delete or update on public.intel_groups
  for each row execute function private.audit();

-- Purpose:        the member check every group write shares: readable, sent.
create or replace function private.intel_group_member_ok(p_submission uuid)
returns void language plpgsql stable security definer set search_path to '' as $$
declare v_status text;
begin
  select status into v_status from public.field_submissions where id = p_submission;
  if v_status is null then raise exception 'no such record'; end if;
  if not private.field_submission_readable(p_submission) then
    raise exception 'that record is not in your jurisdiction';
  end if;
  if v_status = 'draft' then raise exception 'that record has not been sent yet'; end if;
end $$;
revoke all on function private.intel_group_member_ok(uuid) from public, anon, authenticated;

create or replace function public.intel_group_create(p_title text, p_lead uuid, p_members uuid[] default '{}', p_note text default null)
returns uuid language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); v_id uuid; m uuid; v_title text := btrim(coalesce(p_title, ''));
begin
  if not private.is_active() then
    perform private.perm_raise('group', 'field_submission', p_lead, 'not an active member', 'not authorized');
  end if;
  if v_title = '' then raise exception 'give the group a title'; end if;
  if length(v_title) > 200 then raise exception 'a title is at most 200 characters'; end if;
  perform private.intel_group_member_ok(p_lead);
  foreach m in array coalesce(p_members, '{}'::uuid[]) loop
    perform private.intel_group_member_ok(m);
  end loop;

  insert into public.intel_groups (title, note, lead_submission_id, created_by)
  values (v_title, nullif(btrim(coalesce(p_note, '')), ''), p_lead, v_actor)
  returning id into v_id;

  insert into public.intel_group_members (group_id, submission_id, added_by)
  select v_id, x, v_actor
    from unnest(array[p_lead] || coalesce(p_members, '{}'::uuid[])) as x
  on conflict (group_id, submission_id) do nothing;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'INTEL_GROUP_CREATED', 'intel_groups', v_id,
          jsonb_build_object('title', v_title, 'lead', p_lead,
                             'members', (select count(*) from public.intel_group_members where group_id = v_id)));
  return v_id;
end $$;
revoke all on function public.intel_group_create(text, uuid, uuid[], text) from public, anon;
grant execute on function public.intel_group_create(text, uuid, uuid[], text) to authenticated, service_role;

create or replace function public.intel_group_add(p_group uuid, p_submission uuid, p_note text default null)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); g public.intel_groups;
begin
  if not private.is_active() then
    perform private.perm_raise('group', 'field_submission', p_submission, 'not an active member', 'not authorized');
  end if;
  select * into g from public.intel_groups where id = p_group for update;
  if not found or not private.intel_group_readable(p_group) then raise exception 'no such group'; end if;
  if g.closed_at is not null then raise exception 'that group is closed'; end if;
  perform private.intel_group_member_ok(p_submission);
  if exists (select 1 from public.intel_group_members
              where group_id = p_group and submission_id = p_submission and removed_at is null) then
    raise exception 'that record is already in this group';
  end if;

  insert into public.intel_group_members (group_id, submission_id, added_by, note)
  values (p_group, p_submission, v_actor, nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (group_id, submission_id) do update
    set removed_at = null, removed_by = null, remove_reason = null,
        added_by = excluded.added_by, added_at = now(), note = excluded.note;
  update public.intel_groups set updated_at = now() where id = p_group;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'INTEL_GROUP_MEMBER_ADDED', 'intel_groups', p_group,
          jsonb_build_object('submission_id', p_submission));
end $$;
revoke all on function public.intel_group_add(uuid, uuid, text) from public, anon;
grant execute on function public.intel_group_add(uuid, uuid, text) to authenticated, service_role;

create or replace function public.intel_group_remove(p_group uuid, p_submission uuid, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); g public.intel_groups;
begin
  if not private.is_active() then
    perform private.perm_raise('group', 'field_submission', p_submission, 'not an active member', 'not authorized');
  end if;
  if coalesce(btrim(coalesce(p_reason, '')), '') = '' then raise exception 'say why'; end if;
  select * into g from public.intel_groups where id = p_group for update;
  if not found or not private.intel_group_readable(p_group) then raise exception 'no such group'; end if;
  if g.closed_at is not null then raise exception 'that group is closed'; end if;
  if g.lead_submission_id = p_submission then
    raise exception 'the lead record stays in its group — close the group instead';
  end if;
  if not exists (select 1 from public.intel_group_members
                  where group_id = p_group and submission_id = p_submission and removed_at is null) then
    raise exception 'that record is not in this group';
  end if;

  update public.intel_group_members
     set removed_at = now(), removed_by = v_actor, remove_reason = btrim(p_reason)
   where group_id = p_group and submission_id = p_submission;
  update public.intel_groups set updated_at = now() where id = p_group;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'INTEL_GROUP_MEMBER_REMOVED', 'intel_groups', p_group,
          jsonb_build_object('submission_id', p_submission, 'reason', btrim(p_reason)));
end $$;
revoke all on function public.intel_group_remove(uuid, uuid, text) from public, anon;
grant execute on function public.intel_group_remove(uuid, uuid, text) to authenticated, service_role;

create or replace function public.intel_group_link_case(p_group uuid, p_case uuid, p_note text default null)
returns uuid language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); g public.intel_groups; v_id uuid;
begin
  if not private.is_active() then
    perform private.perm_raise('group', 'field_submission', null, 'not an active member', 'not authorized');
  end if;
  select * into g from public.intel_groups where id = p_group for update;
  if not found or not private.intel_group_readable(p_group) then raise exception 'no such group'; end if;
  if g.closed_at is not null then raise exception 'that group is closed'; end if;
  if not private.field_case_visible(p_case) then
    raise exception 'no such case, or it is not one you have access to';
  end if;
  if exists (select 1 from public.intel_group_cases
              where group_id = p_group and case_id = p_case and unlinked_at is null) then
    raise exception 'that group is already linked to that case';
  end if;

  insert into public.intel_group_cases (group_id, case_id, linked_by, note)
  values (p_group, p_case, v_actor, nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (group_id, case_id) do update
    set unlinked_at = null, unlinked_by = null, unlink_reason = null,
        linked_by = excluded.linked_by, linked_at = now(), note = excluded.note
  returning id into v_id;
  update public.intel_groups set updated_at = now() where id = p_group;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'INTEL_GROUP_CASE_LINKED', 'intel_groups', p_group,
          jsonb_build_object('case_id', p_case));
  return v_id;
end $$;
revoke all on function public.intel_group_link_case(uuid, uuid, text) from public, anon;
grant execute on function public.intel_group_link_case(uuid, uuid, text) to authenticated, service_role;

create or replace function public.intel_group_unlink_case(p_group uuid, p_case uuid, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); g public.intel_groups;
begin
  if not private.is_active() then
    perform private.perm_raise('group', 'field_submission', null, 'not an active member', 'not authorized');
  end if;
  if coalesce(btrim(coalesce(p_reason, '')), '') = '' then raise exception 'say why'; end if;
  select * into g from public.intel_groups where id = p_group for update;
  if not found or not private.intel_group_readable(p_group) then raise exception 'no such group'; end if;
  if not exists (select 1 from public.intel_group_cases
                  where group_id = p_group and case_id = p_case and unlinked_at is null) then
    raise exception 'that group is not linked to that case';
  end if;

  update public.intel_group_cases
     set unlinked_at = now(), unlinked_by = v_actor, unlink_reason = btrim(p_reason)
   where group_id = p_group and case_id = p_case;
  update public.intel_groups set updated_at = now() where id = p_group;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'INTEL_GROUP_CASE_UNLINKED', 'intel_groups', p_group,
          jsonb_build_object('case_id', p_case, 'reason', btrim(p_reason)));
end $$;
revoke all on function public.intel_group_unlink_case(uuid, uuid, text) from public, anon;
grant execute on function public.intel_group_unlink_case(uuid, uuid, text) to authenticated, service_role;

-- Close / reopen: the creator or command.
create or replace function public.intel_group_close(p_group uuid, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); g public.intel_groups;
begin
  if not private.is_active() then
    perform private.perm_raise('group', 'field_submission', null, 'not an active member', 'not authorized');
  end if;
  if coalesce(btrim(coalesce(p_reason, '')), '') = '' then raise exception 'say why'; end if;
  select * into g from public.intel_groups where id = p_group for update;
  if not found or not private.intel_group_readable(p_group) then raise exception 'no such group'; end if;
  if g.closed_at is not null then raise exception 'that group is already closed'; end if;
  if g.created_by is distinct from v_actor and not private.is_command() then
    perform private.perm_raise('group', 'field_submission', g.lead_submission_id, 'close: creator or command',
                               'only the group''s creator or a Bureau Lead or above can close it');
  end if;
  update public.intel_groups
     set closed_at = now(), closed_by = v_actor, close_reason = btrim(p_reason), updated_at = now()
   where id = p_group;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'INTEL_GROUP_CLOSED', 'intel_groups', p_group, jsonb_build_object('reason', btrim(p_reason)));
end $$;
revoke all on function public.intel_group_close(uuid, text) from public, anon;
grant execute on function public.intel_group_close(uuid, text) to authenticated, service_role;

create or replace function public.intel_group_reopen(p_group uuid, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); g public.intel_groups;
begin
  if not private.is_active() then
    perform private.perm_raise('group', 'field_submission', null, 'not an active member', 'not authorized');
  end if;
  if coalesce(btrim(coalesce(p_reason, '')), '') = '' then raise exception 'say why'; end if;
  select * into g from public.intel_groups where id = p_group for update;
  if not found or not private.intel_group_readable(p_group) then raise exception 'no such group'; end if;
  if g.closed_at is null then raise exception 'that group is not closed'; end if;
  if g.created_by is distinct from v_actor and not private.is_command() then
    perform private.perm_raise('group', 'field_submission', g.lead_submission_id, 'reopen: creator or command',
                               'only the group''s creator or a Bureau Lead or above can reopen it');
  end if;
  update public.intel_groups
     set closed_at = null, closed_by = null, close_reason = null, updated_at = now()
   where id = p_group;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'INTEL_GROUP_REOPENED', 'intel_groups', p_group, jsonb_build_object('reason', btrim(p_reason)));
end $$;
revoke all on function public.intel_group_reopen(uuid, text) from public, anon;
grant execute on function public.intel_group_reopen(uuid, text) to authenticated, service_role;

-- Purpose:        what a reviewer confirms into a group: the READABLE records
--                 that share a named / linked signal with this one (the
--                 repeat signal) and the live groups any of them already
--                 belongs to. Numbers and labels only — never a summary.
create or replace function public.intel_group_suggest(p_submission uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_out jsonb;
begin
  if not private.is_active() then return jsonb_build_object('groups', '[]'::jsonb, 'submissions', '[]'::jsonb); end if;
  if not private.field_submission_readable(p_submission) then
    raise exception 'that record is not in your jurisdiction';
  end if;

  with mine as (
    select 'person' as kind, lower(btrim(p.full_name)) as key, btrim(p.full_name) as label
      from public.field_submission_persons p
     where p.submission_id = p_submission and length(btrim(coalesce(p.full_name, ''))) > 1
    union
    select 'person', lower(btrim(p.alias)), btrim(p.alias)
      from public.field_submission_persons p
     where p.submission_id = p_submission and length(btrim(coalesce(p.alias, ''))) > 1
    union
    select 'vehicle', lower(btrim(v.plate)), btrim(v.plate)
      from public.field_submission_vehicles v
     where v.submission_id = p_submission and length(btrim(coalesce(v.plate, ''))) > 1
    union
    select 'organisation', lower(btrim(o.name)), btrim(o.name)
      from public.field_submission_orgs o
     where o.submission_id = p_submission and length(btrim(coalesce(o.name, ''))) > 1
  ),
  named as (
    select x.submission_id, m.label
      from mine m
      join (
        select 'person' as kind, lower(btrim(p.full_name)) as key, p.submission_id from public.field_submission_persons p
        union all
        select 'person', lower(btrim(p.alias)), p.submission_id from public.field_submission_persons p
        union all
        select 'vehicle', lower(btrim(v.plate)), v.submission_id from public.field_submission_vehicles v
        union all
        select 'organisation', lower(btrim(o.name)), o.submission_id from public.field_submission_orgs o
      ) x on x.kind = m.kind and x.key = m.key
     where x.submission_id <> p_submission
  ),
  pins as (
    select l.submission_id, 'person' as kind, l.person_id as ref from public.field_claim_links l where l.person_id is not null
    union all select l.submission_id, 'vehicle', l.vehicle_id from public.field_claim_links l where l.vehicle_id is not null
    union all select l.submission_id, 'organisation', l.gang_id from public.field_claim_links l where l.gang_id is not null
    union all select l.submission_id, 'place', l.place_id from public.field_claim_links l where l.place_id is not null
    union all select l.submission_id, 'narcotic', l.narcotic_id from public.field_claim_links l where l.narcotic_id is not null
    union all select l.submission_id, 'account', l.account_id from public.field_claim_links l where l.account_id is not null
    union all select l.submission_id, 'indicator', l.indicator_id from public.field_claim_links l where l.indicator_id is not null
  ),
  linked as (
    select b.submission_id,
           case when private.perm_registry_visible(case a.kind when 'organisation' then 'gang' else a.kind end, a.ref)
                     or (a.kind = 'indicator' and exists (select 1 from public.indicators ii where ii.id = a.ref
                                                            and private.field_case_visible(ii.case_id)))
                then coalesce(pe.name, ve.plate, ga.name, pl.name, na.name, ac.handle, ind.value, 'a matched record')
                else 'a matched record' end as label
      from pins a
      join pins b on b.kind = a.kind and b.ref = a.ref and b.submission_id <> a.submission_id
      left join public.persons pe on a.kind = 'person' and pe.id = a.ref
      left join public.vehicles ve on a.kind = 'vehicle' and ve.id = a.ref
      left join public.gangs ga on a.kind = 'organisation' and ga.id = a.ref
      left join public.places pl on a.kind = 'place' and pl.id = a.ref
      left join public.narcotics na on a.kind = 'narcotic' and na.id = a.ref
      left join public.accounts ac on a.kind = 'account' and ac.id = a.ref
      left join public.indicators ind on a.kind = 'indicator' and ind.id = a.ref
     where a.submission_id = p_submission
  ),
  sig as (
    select distinct z.submission_id, z.label
      from (select * from named union all select * from linked) z
      join public.field_submissions s on s.id = z.submission_id
     where s.deleted_at is null and s.status <> 'draft' and private.field_submission_readable(s.id)
  ),
  subs as (
    select s.id, s.submission_no, s.status, s.submitted_at,
           (select jsonb_agg(distinct t.label) from sig t where t.submission_id = s.id) as shared
      from public.field_submissions s
     where s.id in (select submission_id from sig)
     order by s.submitted_at desc nulls last
     limit 20
  ),
  grps as (
    select g.id, g.title, g.updated_at,
           (select ls.submission_no from public.field_submissions ls where ls.id = g.lead_submission_id) as lead_submission_no,
           (select count(*) from public.intel_group_members m2 where m2.group_id = g.id and m2.removed_at is null) as members,
           (select jsonb_agg(distinct t.label) from sig t
              join public.intel_group_members m3 on m3.submission_id = t.submission_id and m3.group_id = g.id and m3.removed_at is null) as shared
      from public.intel_groups g
     where g.closed_at is null
       and private.field_submission_readable(g.lead_submission_id)
       and exists (select 1 from public.intel_group_members m join sig t on t.submission_id = m.submission_id
                    where m.group_id = g.id and m.removed_at is null)
       and not exists (select 1 from public.intel_group_members m
                        where m.group_id = g.id and m.submission_id = p_submission and m.removed_at is null)
     order by g.updated_at desc
     limit 20
  )
  select jsonb_build_object(
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'lead_submission_no', lead_submission_no,
                                                            'members', members, 'shared', coalesce(shared, '[]'::jsonb)) order by updated_at desc) from grps), '[]'::jsonb),
    'submissions', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'submission_no', submission_no, 'status', status,
                                                                 'shared', coalesce(shared, '[]'::jsonb)) order by submitted_at desc nulls last) from subs), '[]'::jsonb))
    into v_out;
  return v_out;
end $$;
revoke all on function public.intel_group_suggest(uuid) from public, anon;
grant execute on function public.intel_group_suggest(uuid) to authenticated, service_role;

-- Purpose:        the group at a glance. Readable members carry a number;
--                 the rest are counted as hidden.
create or replace function public.intel_group_summary(p_group uuid)
returns jsonb language sql stable security definer set search_path to '' as $$
  select case when not private.intel_group_readable(p_group) then null else (
    select jsonb_build_object(
      'id', g.id, 'title', g.title, 'note', g.note, 'lead_submission_id', g.lead_submission_id,
      'created_by', g.created_by, 'created_at', g.created_at, 'closed_at', g.closed_at, 'close_reason', g.close_reason,
      'members', coalesce((select jsonb_agg(jsonb_build_object(
                    'submission_id', m.submission_id, 'submission_no', s.submission_no, 'status', s.status,
                    'added_at', m.added_at, 'note', m.note) order by m.added_at)
                  from public.intel_group_members m join public.field_submissions s on s.id = m.submission_id
                 where m.group_id = g.id and m.removed_at is null and private.field_submission_readable(m.submission_id)), '[]'::jsonb),
      'hidden', (select count(*) from public.intel_group_members m
                  where m.group_id = g.id and m.removed_at is null and not private.field_submission_readable(m.submission_id)),
      'claims', (select coalesce(sum(st.p_claims), 0) from public.intel_group_members m
                  cross join lateral private.field_validation_state(m.submission_id) st
                 where m.group_id = g.id and m.removed_at is null and private.field_submission_readable(m.submission_id)),
      'decided', (select coalesce(sum(st.p_decided), 0) from public.intel_group_members m
                   cross join lateral private.field_validation_state(m.submission_id) st
                  where m.group_id = g.id and m.removed_at is null and private.field_submission_readable(m.submission_id)),
      'cases', coalesce((select jsonb_agg(jsonb_build_object('case_id', c.id, 'case_number', c.case_number, 'title', c.title) order by gc.linked_at)
                  from public.intel_group_cases gc join public.cases c on c.id = gc.case_id
                 where gc.group_id = g.id and gc.unlinked_at is null and private.field_case_visible(c.id)), '[]'::jsonb))
    from public.intel_groups g where g.id = p_group) end
$$;
revoke all on function public.intel_group_summary(uuid) from public, anon;
grant execute on function public.intel_group_summary(uuid) to authenticated, service_role;

-- A grouped record is a dependency for a soft delete.
create or replace function private.field_submission_dependencies(p_submission uuid)
returns jsonb language sql stable security definer set search_path to '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'claim links', nullif((select count(*) from public.field_claim_links l
                            where l.submission_id = p_submission), 0),
    'claim verdicts', nullif((select count(*) from public.field_claim_verdicts v
                               where v.submission_id = p_submission), 0),
    'evidence', nullif((select count(*) from public.field_submission_evidence e
                         where e.submission_id = p_submission), 0),
    'cases', nullif((select count(*) from public.field_submission_cases c
                      where c.submission_id = p_submission
                        and c.unlinked_at is null), 0),
    'surveillance observations', nullif((select count(*)
                                           from public.surveillance_observations o
                                          where o.field_submission_id = p_submission), 0),
    'a registered confidential source', nullif((select count(*)
                                                  from public.field_submission_sources fs
                                                 where fs.submission_id = p_submission), 0),
    'SIB handling', nullif((select count(*) from public.field_siu_actions a
                             where a.submission_id = p_submission), 0),
    'SIB assessment', nullif((select count(*) from public.field_siu_enterprise n
                               where n.submission_id = p_submission
                                 and n.removed_at is null), 0),
    'SIB follow-ups', nullif((select count(*) from public.field_siu_followups f
                               where f.submission_id = p_submission
                                 and f.cleared_at is null), 0),
    'SIB targets', nullif((select count(*) from public.siu_targets t
                            where t.field_submission_id = p_submission
                              and t.cleared_at is null), 0),
    'an SIB investigation', nullif((select count(*) from public.field_submissions s
                                     where s.id = p_submission
                                       and s.siu_case_id is not null), 0),
    'messages with the author', nullif((select count(*)
                                          from public.field_submission_messages m
                                         where m.submission_id = p_submission), 0),
    'intel groups', nullif((select count(*) from public.intel_group_members m
                             where m.submission_id = p_submission and m.removed_at is null)
                         + (select count(*) from public.intel_groups g
                             where g.lead_submission_id = p_submission), 0)
  ))
$$;

-- ---------------------------------------------------------------------------
-- 2. Extended claim links (P6-04)
-- ---------------------------------------------------------------------------
alter table public.field_claim_links
  add column if not exists claim_item_id uuid references public.field_submission_items(id) on delete cascade,
  add column if not exists narcotic_id uuid references public.narcotics(id) on delete set null,
  add column if not exists account_id uuid references public.accounts(id) on delete set null,
  add column if not exists indicator_id uuid references public.indicators(id) on delete set null;
alter table public.field_claim_links drop constraint if exists field_claim_links_one_claim;
alter table public.field_claim_links add constraint field_claim_links_one_claim
  check (num_nonnulls(claim_person_id, claim_vehicle_id, claim_org_id, claim_location_id, claim_item_id) = 1);
alter table public.field_claim_links drop constraint if exists field_claim_links_one_target;
alter table public.field_claim_links add constraint field_claim_links_one_target
  check (num_nonnulls(person_id, vehicle_id, gang_id, place_id, narcotic_id, account_id, indicator_id) = 1);
create index if not exists field_claim_links_narcotic_idx on public.field_claim_links (narcotic_id) where narcotic_id is not null;
create index if not exists field_claim_links_account_idx on public.field_claim_links (account_id) where account_id is not null;
create index if not exists field_claim_links_indicator_idx on public.field_claim_links (indicator_id) where indicator_id is not null;

-- The provenance pointer: a record converted from a claim remembers it.
alter table public.persons   add column if not exists source_submission_id uuid references public.field_submissions(id) on delete set null;
alter table public.vehicles  add column if not exists source_submission_id uuid references public.field_submissions(id) on delete set null;
alter table public.gangs     add column if not exists source_submission_id uuid references public.field_submissions(id) on delete set null;
alter table public.places    add column if not exists source_submission_id uuid references public.field_submissions(id) on delete set null;
alter table public.accounts  add column if not exists source_submission_id uuid references public.field_submissions(id) on delete set null;
alter table public.narcotics add column if not exists source_submission_id uuid references public.field_submissions(id) on delete set null;

-- Purpose:        the claim → target pair rule (an identity assertion: a
--                 claim links to the record it IS).
create or replace function private.field_claim_pair_ok(p_claim_kind text, p_target_kind text)
returns boolean language sql immutable set search_path to '' as $$
  select case p_claim_kind
    when 'person'   then p_target_kind in ('person', 'account', 'indicator')
    when 'vehicle'  then p_target_kind in ('vehicle', 'indicator')
    when 'org'      then p_target_kind in ('gang', 'account', 'indicator')
    when 'location' then p_target_kind in ('place', 'indicator')
    when 'item'     then p_target_kind in ('narcotic', 'indicator')
    else false end
$$;
revoke all on function private.field_claim_pair_ok(text, text) from public, anon;
grant execute on function private.field_claim_pair_ok(text, text) to authenticated, service_role;

-- Purpose:        the submission behind a claim (null when there is none).
create or replace function private.field_claim_submission(p_kind text, p_claim uuid)
returns uuid language sql stable security definer set search_path to '' as $$
  select case p_kind
    when 'person'   then (select submission_id from public.field_submission_persons where id = p_claim)
    when 'vehicle'  then (select submission_id from public.field_submission_vehicles where id = p_claim)
    when 'org'      then (select submission_id from public.field_submission_orgs where id = p_claim)
    when 'location' then (select submission_id from public.field_submission_locations where id = p_claim)
    when 'item'     then (select submission_id from public.field_submission_items where id = p_claim)
    else null end
$$;
revoke all on function private.field_claim_submission(text, uuid) from public, anon, authenticated;

-- Purpose:        a target exists, is live and (an indicator) sits on a case
--                 the caller can see.
create or replace function private.field_link_target_ok(p_target_kind text, p_target uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select case
    when p_target_kind = 'indicator' then
      exists (select 1 from public.indicators i where i.id = p_target and i.deleted_at is null
               and private.field_case_visible(i.case_id))
    when p_target_kind in ('person', 'vehicle', 'gang', 'place', 'narcotic', 'account') then
      (select st.p_exists and st.p_deleted_at is null from private.soft_delete_state(p_target_kind, p_target) st)
      and private.perm_registry_visible(p_target_kind, p_target)
    else false end
$$;
revoke all on function private.field_link_target_ok(text, uuid) from public, anon, authenticated;

create or replace function public.field_claim_link(p_kind text, p_claim uuid, p_target_kind text, p_target uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); v_submission uuid;
begin
  if not private.is_active() then raise exception 'not authorized'; end if;

  v_submission := private.field_claim_submission(p_kind, p_claim);
  if v_submission is null then raise exception 'no such claim: % %', p_kind, p_claim; end if;
  if not private.field_submission_readable(v_submission) then
    perform private.perm_raise('link', 'field_submission', v_submission, 'outside the read wall', 'that record is not in your jurisdiction');
  end if;
  if (select status from public.field_submissions where id = v_submission) = 'draft' then
    raise exception 'that report has not been sent yet';
  end if;
  if not private.field_claim_pair_ok(p_kind, p_target_kind) then
    raise exception 'a % claim cannot be linked to a %', p_kind, p_target_kind;
  end if;
  if not private.field_link_target_ok(p_target_kind, p_target) then
    raise exception 'no such %: %', p_target_kind, p_target;
  end if;
  if exists (select 1 from public.field_claim_links l
              where l.submission_id = v_submission
                and coalesce(l.claim_person_id, l.claim_vehicle_id, l.claim_org_id, l.claim_location_id, l.claim_item_id) = p_claim
                and coalesce(l.person_id, l.vehicle_id, l.gang_id, l.place_id, l.narcotic_id, l.account_id, l.indicator_id) = p_target) then
    raise exception 'already linked';
  end if;

  insert into public.field_claim_links
    (submission_id, claim_person_id, claim_vehicle_id, claim_org_id, claim_location_id, claim_item_id,
     person_id, vehicle_id, gang_id, place_id, narcotic_id, account_id, indicator_id, linked_by)
  values (v_submission,
          case when p_kind = 'person'   then p_claim end,
          case when p_kind = 'vehicle'  then p_claim end,
          case when p_kind = 'org'      then p_claim end,
          case when p_kind = 'location' then p_claim end,
          case when p_kind = 'item'     then p_claim end,
          case when p_target_kind = 'person'    then p_target end,
          case when p_target_kind = 'vehicle'   then p_target end,
          case when p_target_kind = 'gang'      then p_target end,
          case when p_target_kind = 'place'     then p_target end,
          case when p_target_kind = 'narcotic'  then p_target end,
          case when p_target_kind = 'account'   then p_target end,
          case when p_target_kind = 'indicator' then p_target end,
          v_actor);

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_CLAIM_LINKED', 'field_claim_links', v_submission,
          jsonb_build_object('claim_kind', p_kind, 'claim_id', p_claim,
                             'target_kind', p_target_kind, 'target_id', p_target));
end $$;

-- The repeat signal follows the new pins.
create or replace function public.field_submission_repeats(p_submission uuid)
returns table(kind text, label text, basis text, others integer, records text[])
language plpgsql stable security definer set search_path to '' as $$
begin
  if not private.field_submission_readable(p_submission) then
    raise exception 'that record is not in your jurisdiction';
  end if;

  return query
  with mine as (
    select 'person' as kind, lower(btrim(p.full_name)) as key, btrim(p.full_name) as label
      from public.field_submission_persons p
     where p.submission_id = p_submission and length(btrim(coalesce(p.full_name, ''))) > 1
    union
    select 'person', lower(btrim(p.alias)), btrim(p.alias)
      from public.field_submission_persons p
     where p.submission_id = p_submission and length(btrim(coalesce(p.alias, ''))) > 1
    union
    select 'vehicle', lower(btrim(v.plate)), btrim(v.plate)
      from public.field_submission_vehicles v
     where v.submission_id = p_submission and length(btrim(coalesce(v.plate, ''))) > 1
    union
    select 'organisation', lower(btrim(o.name)), btrim(o.name)
      from public.field_submission_orgs o
     where o.submission_id = p_submission and length(btrim(coalesce(o.name, ''))) > 1
  ),
  named as (
    select m.kind, m.label, 'named'::text as basis, x.submission_id
      from mine m
      join (
        select 'person' as kind, lower(btrim(p.full_name)) as key, p.submission_id
          from public.field_submission_persons p
        union all
        select 'person', lower(btrim(p.alias)), p.submission_id
          from public.field_submission_persons p
        union all
        select 'vehicle', lower(btrim(v.plate)), v.submission_id
          from public.field_submission_vehicles v
        union all
        select 'organisation', lower(btrim(o.name)), o.submission_id
          from public.field_submission_orgs o
      ) x on x.kind = m.kind and x.key = m.key
     where x.submission_id <> p_submission
  ),
  pins as (
    select l.submission_id, 'person' as kind, l.person_id as ref
      from public.field_claim_links l where l.person_id is not null
    union all
    select l.submission_id, 'vehicle', l.vehicle_id
      from public.field_claim_links l where l.vehicle_id is not null
    union all
    select l.submission_id, 'organisation', l.gang_id
      from public.field_claim_links l where l.gang_id is not null
    union all
    select l.submission_id, 'place', l.place_id
      from public.field_claim_links l where l.place_id is not null
    union all
    select l.submission_id, 'narcotic', l.narcotic_id
      from public.field_claim_links l where l.narcotic_id is not null
    union all
    select l.submission_id, 'account', l.account_id
      from public.field_claim_links l where l.account_id is not null
    union all
    select l.submission_id, 'indicator', l.indicator_id
      from public.field_claim_links l where l.indicator_id is not null
  ),
  linked as (
    select a.kind,
           case when private.perm_registry_visible(case a.kind when 'organisation' then 'gang' else a.kind end, a.ref)
                     or (a.kind = 'indicator' and exists (select 1 from public.indicators ii where ii.id = a.ref
                                                            and private.field_case_visible(ii.case_id)))
                then coalesce(pe.name, ve.plate, ga.name, pl.name, na.name, ac.handle, ind.value, 'a matched record')
                else 'a matched record' end as label,
           'linked'::text as basis,
           b.submission_id
      from pins a
      join pins b on b.kind = a.kind and b.ref = a.ref
                 and b.submission_id <> a.submission_id
      left join public.persons pe on a.kind = 'person' and pe.id = a.ref
      left join public.vehicles ve on a.kind = 'vehicle' and ve.id = a.ref
      left join public.gangs ga on a.kind = 'organisation' and ga.id = a.ref
      left join public.places pl on a.kind = 'place' and pl.id = a.ref
      left join public.narcotics na on a.kind = 'narcotic' and na.id = a.ref
      left join public.accounts ac on a.kind = 'account' and ac.id = a.ref
      left join public.indicators ind on a.kind = 'indicator' and ind.id = a.ref
     where a.submission_id = p_submission
  ),
  signals as (select * from named union all select * from linked)
  select b.kind, b.label, b.basis,
         count(distinct b.submission_id)::int,
         array_agg(distinct coalesce(s.submission_no, 'a draft'))
    from signals b
    join public.field_submissions s on s.id = b.submission_id
   where private.field_submission_readable(b.submission_id)
   group by b.kind, b.label, b.basis
   order by 4 desc, 2;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Convert a claim into a registry record (P6-04, IT8 / EA1 / EA10)
-- ---------------------------------------------------------------------------
-- Purpose:        creates the record from the claim's payload with the
--                 provenance pointer, links the claim, returns {ok, id, kind};
--                 a strong duplicate answers {ok:false, code:'duplicate',
--                 matches} until the caller gives a reason (never hard-block;
--                 reuse is the default). Only matches the caller may see are
--                 named. Authority refusals answer {ok:false, code:'denied'}.
create or replace function public.field_submission_convert(p_kind text, p_claim_kind text, p_claim uuid, p_payload jsonb, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_submission uuid; v_no text; v_status text;
  j jsonb := coalesce(p_payload, '{}'::jsonb);
  v_allowed text[]; v_required text[]; k text; v_id uuid;
  v_matches jsonb; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_notes text; v_note_col text;
begin
  if not private.is_active() then
    return jsonb_build_object('ok', false, 'code', 'denied', 'message', 'not authorized');
  end if;
  if p_kind not in ('person', 'vehicle', 'gang', 'place', 'account', 'narcotic') then
    raise exception 'unknown kind: %', p_kind;
  end if;
  v_submission := private.field_claim_submission(p_claim_kind, p_claim);
  if v_submission is null then raise exception 'no such claim: % %', p_claim_kind, p_claim; end if;
  if not private.field_submission_readable(v_submission) then
    perform private.perm_deny('convert', 'field_submission', v_submission, 'outside the read wall');
    return jsonb_build_object('ok', false, 'code', 'denied', 'message', 'that record is not in your jurisdiction');
  end if;
  select status, submission_no into v_status, v_no from public.field_submissions where id = v_submission;
  if v_status = 'draft' then raise exception 'that report has not been sent yet'; end if;
  if not private.field_claim_pair_ok(p_claim_kind, p_kind) then
    raise exception 'a % claim cannot become a %', p_claim_kind, p_kind;
  end if;
  if jsonb_typeof(j) <> 'object' then raise exception 'payload must be an object'; end if;

  v_allowed := case p_kind
    when 'person'   then array['name', 'alias', 'dob', 'phone', 'notes']
    when 'vehicle'  then array['plate', 'model', 'color', 'notes']
    when 'gang'     then array['name', 'aliases', 'colors', 'notes']
    when 'place'    then array['name', 'type', 'area', 'notes']
    when 'account'  then array['platform', 'handle', 'display_name', 'summary']
    when 'narcotic' then array['name', 'category', 'summary'] end;
  v_required := case p_kind
    when 'person'   then array['name']
    when 'vehicle'  then array['plate']
    when 'gang'     then array['name']
    when 'place'    then array['name', 'type']
    when 'account'  then array['platform', 'handle']
    when 'narcotic' then array['name', 'category'] end;
  for k in select jsonb_object_keys(j) loop
    if not (k = any(v_allowed)) then raise exception 'unknown field for a %: %', p_kind, k; end if;
    if jsonb_typeof(j -> k) not in ('string', 'null') then raise exception 'field % must be a string', k; end if;
  end loop;
  foreach k in array v_required loop
    if coalesce(btrim(j ->> k), '') = '' then raise exception 'field % is required for a %', k, p_kind; end if;
  end loop;
  if p_kind = 'place' and (j ->> 'type') not in ('drug_lab', 'stash_house', 'dead_drop', 'front_business', 'chop_shop') then
    raise exception 'choose one of the place types';
  end if;
  if p_kind = 'narcotic' and (j ->> 'category') not in ('cannabis', 'stimulant', 'opioid', 'sedative', 'hallucinogen', 'synthetic', 'unknown') then
    raise exception 'choose one of the narcotic categories';
  end if;
  if p_kind = 'person' and nullif(btrim(coalesce(j ->> 'dob', '')), '') is not null
     and (j ->> 'dob') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'the date of birth must be YYYY-MM-DD';
  end if;

  -- Duplicate detection (the registry's own matcher), filtered to what the
  -- caller may see; a strong match without a reason is the answer.
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label, 'sublabel', d.sublabel, 'signal', d.signal)), '[]'::jsonb)
    into v_matches
    from public.entity_duplicates(p_kind, j) d
   where d.strength = 'strong'
     and private.perm_registry_visible(p_kind, d.id)
     and (select st.p_exists and st.p_deleted_at is null from private.soft_delete_state(p_kind, d.id) st);
  if jsonb_array_length(v_matches) > 0 and v_reason is null then
    return jsonb_build_object('ok', false, 'code', 'duplicate', 'matches', v_matches,
                              'message', 'a record like this already exists — link it, or create anyway with a reason');
  end if;

  v_note_col := case when p_kind in ('account', 'narcotic') then 'summary' else 'notes' end;
  v_notes := nullif(btrim(coalesce(j ->> v_note_col, '')), '');
  if v_reason is not null and jsonb_array_length(v_matches) > 0 then
    v_notes := concat_ws(E'\n', v_notes, 'Created despite a possible duplicate: ' || v_reason);
  end if;

  case p_kind
    when 'person' then
      insert into public.persons (name, alias, dob, phone, notes, created_by, source_submission_id)
      values (btrim(j ->> 'name'), nullif(btrim(coalesce(j ->> 'alias', '')), ''),
              nullif(btrim(coalesce(j ->> 'dob', '')), '')::date,
              nullif(btrim(coalesce(j ->> 'phone', '')), ''), v_notes, v_actor, v_submission)
      returning id into v_id;
    when 'vehicle' then
      insert into public.vehicles (plate, model, color, notes, created_by, source_submission_id)
      values (btrim(j ->> 'plate'), nullif(btrim(coalesce(j ->> 'model', '')), ''),
              nullif(btrim(coalesce(j ->> 'color', '')), ''), v_notes, v_actor, v_submission)
      returning id into v_id;
    when 'gang' then
      insert into public.gangs (name, aliases, colors, notes, created_by, source_submission_id)
      values (btrim(j ->> 'name'), nullif(btrim(coalesce(j ->> 'aliases', '')), ''),
              nullif(btrim(coalesce(j ->> 'colors', '')), ''), v_notes, v_actor, v_submission)
      returning id into v_id;
    when 'place' then
      insert into public.places (name, type, area, notes, created_by, source_submission_id)
      values (btrim(j ->> 'name'), (j ->> 'type')::public.location_type,
              nullif(btrim(coalesce(j ->> 'area', '')), ''), v_notes, v_actor, v_submission)
      returning id into v_id;
    when 'account' then
      insert into public.accounts (platform, handle, display_name, summary, created_by, source_submission_id)
      values (btrim(j ->> 'platform'), btrim(j ->> 'handle'),
              nullif(btrim(coalesce(j ->> 'display_name', '')), ''), v_notes, v_actor, v_submission)
      returning id into v_id;
    when 'narcotic' then
      -- The registry's own client guard does not engage for a definer insert:
      -- a non-manager's substance lands unidentified / unverified as it would
      -- through the sheet.
      insert into public.narcotics (name, category, summary, status, confidence, created_by, source_submission_id)
      values (btrim(j ->> 'name'), btrim(j ->> 'category'), v_notes,
              case when private.can_manage_narcotics() then 'reported' else 'unidentified' end,
              'unverified', v_actor, v_submission)
      returning id into v_id;
  end case;

  insert into public.field_claim_links
    (submission_id, claim_person_id, claim_vehicle_id, claim_org_id, claim_location_id, claim_item_id,
     person_id, vehicle_id, gang_id, place_id, narcotic_id, account_id, linked_by)
  values (v_submission,
          case when p_claim_kind = 'person'   then p_claim end,
          case when p_claim_kind = 'vehicle'  then p_claim end,
          case when p_claim_kind = 'org'      then p_claim end,
          case when p_claim_kind = 'location' then p_claim end,
          case when p_claim_kind = 'item'     then p_claim end,
          case when p_kind = 'person'   then v_id end,
          case when p_kind = 'vehicle'  then v_id end,
          case when p_kind = 'gang'     then v_id end,
          case when p_kind = 'place'    then v_id end,
          case when p_kind = 'narcotic' then v_id end,
          case when p_kind = 'account'  then v_id end,
          v_actor);

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_CLAIM_CONVERTED', 'field_submissions', v_submission,
          jsonb_build_object('submission_no', v_no, 'claim_kind', p_claim_kind, 'claim_id', p_claim,
                             'kind', p_kind, 'record_id', v_id,
                             'despite_duplicate', v_reason is not null and jsonb_array_length(v_matches) > 0));
  return jsonb_build_object('ok', true, 'id', v_id, 'kind', p_kind);
end $$;
revoke all on function public.field_submission_convert(text, text, uuid, jsonb, text) from public, anon;
grant execute on function public.field_submission_convert(text, text, uuid, jsonb, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. SIB referral cross-link (P6-07): the origin records, for agents only —
--    never oversight standing, never a summary.
-- ---------------------------------------------------------------------------
create or replace function public.siu_referred_submissions()
returns table(id uuid, submission_no text, siu_category text, siu_state text, siu_referred_at timestamptz,
              siu_referred_by uuid, siu_assigned_to uuid, siu_case_id uuid, jurisdiction text)
language sql stable security definer set search_path to '' as $$
  select s.id, s.submission_no, s.siu_category, s.siu_state, s.siu_referred_at,
         s.siu_referred_by, s.siu_assigned_to, s.siu_case_id, s.jurisdiction
    from public.field_submissions s
   where private.siu_is_agent()
     and s.deleted_at is null
     and s.siu_state in ('referred', 'accepted')
   order by s.siu_referred_at desc nulls last
   limit 200
$$;
revoke all on function public.siu_referred_submissions() from public, anon;
grant execute on function public.siu_referred_submissions() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. perm_dispatch: the field_submission arm (P6-08). Every other arm is
--    byte-identical to 20261029120000.
-- ---------------------------------------------------------------------------
create or replace function private.perm_dispatch(p_action text, p_kind text, p_id uuid)
returns boolean language sql stable security definer set search_path to '' as $function$
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
$function$;

-- ---------------------------------------------------------------------------
-- 5b. perm_denied_ack hardening (security review M4): a client acknowledges
--     only a refusal the server agrees with, for a catalogued pair, at most
--     twenty rows per actor per ten minutes.
-- ---------------------------------------------------------------------------
create or replace function public.perm_denied_ack(p_action text, p_kind text, p_id uuid, p_reason text default null)
returns boolean language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); v_action text := lower(btrim(coalesce(p_action, ''))); v_kind text := lower(btrim(coalesce(p_kind, '')));
begin
  if v_uid is null or v_action = '' or v_kind = '' then return false; end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid) then return false; end if;
  if not exists (select 1 from public.permission_catalog c where c.action = v_action and (c.kind = v_kind or c.kind = '*')) then
    return false;
  end if;
  if p_id is not null and public.can_record(v_action, v_kind, p_id) then return false; end if;
  if exists (select 1 from public.audit_log a
              where a.actor_id = v_uid and a.action = 'PERMISSION_DENIED'
                and a.entity = v_kind and a.entity_id is not distinct from p_id
                and a.detail->>'action' = v_action
                and a.created_at > now() - interval '1 minute') then
    return false;
  end if;
  if (select count(*) from public.audit_log a
       where a.actor_id = v_uid and a.action = 'PERMISSION_DENIED'
         and a.detail->>'source' = 'client_ack'
         and a.created_at > now() - interval '10 minutes') >= 20 then
    return false;
  end if;
  perform private.perm_deny(v_action, v_kind, p_id, p_reason, 'client_ack');
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Catalog rows (P6-08)
-- ---------------------------------------------------------------------------
insert into public.permission_catalog (action, kind, area, rule, enforcing_object, test_id, matrix, sort_order) values
  ('reject', 'field_submission', 'Reject an intelligence record', 'Any active reviewer who can read it, with a reason, while it is open; terminal for reviewers — only a Bureau Lead or above restores it. The submitter sees "Closed" and never the reason.', 'public.field_submission_reject', 'v188a', '{"owner":"✓","command":"✓","member":"read access","inactive":"✗"}', 390),
  ('restore', 'field_submission', 'Restore an archived or rejected record', 'From the archive: any active reviewer who can read it. From rejected: a Bureau Lead, Deputy Director, Director or the Owner.', 'public.field_submission_restore', 'v188a', '{"owner":"✓","command":"✓","member":"archived only","inactive":"✗"}', 400),
  ('comment', 'field_submission', 'Comment on an intelligence record', 'Any active reviewer who can read a sent record: a private note to reviewers, or a message the officer reads. Neither changes the status; the note table takes no direct client writes.', 'public.field_submission_comment', 'v188a', '{"owner":"✓","command":"✓","member":"read access","inactive":"✗"}', 410),
  ('validate', 'field_submission', 'Mark an intelligence record validated', 'Any active reviewer who can read it, once every claim has a verdict and the source is graded; withdrawing needs a note. Per-claim verdicts remain the unit of truth.', 'public.field_submission_validate', 'v188a', '{"owner":"✓","command":"✓","member":"read access","inactive":"✗"}', 420),
  ('group', 'field_submission', 'Group related intelligence records', 'Any active reviewer, over records they can read; a group never merges, deletes or edits a member. Close / reopen: the creator or a Bureau Lead or above.', 'public.intel_group_create / _add / _remove / _link_case', 'v188c', '{"owner":"✓","command":"✓","member":"read access","inactive":"✗"}', 430),
  ('convert', 'field_submission', 'Convert a claim into a registry record', 'Any active reviewer who can read the record; the registry''s duplicate matcher answers first, and creating anyway needs a reason. The new record carries the source submission as provenance and the claim is linked.', 'public.field_submission_convert', 'v188c', '{"owner":"✓","command":"✓","member":"read access","inactive":"✗"}', 440),
  ('link', 'field_submission', 'Link a claim to a registry record', 'Any active reviewer who can read the record: person, vehicle, gang, place, narcotic, account or indicator by the claim → target rule; the target must exist, be live and visible (an indicator: on a case the reviewer can see).', 'public.field_claim_link → private.field_claim_pair_ok', 'v188c', '{"owner":"✓","command":"✓","member":"read access","inactive":"✗"}', 450),
  ('assign', 'field_submission', 'Assign or reassign an intelligence record', 'A Bureau Lead or above who can read it; a reassignment needs a reason; the assignee is told.', 'public.field_submission_assign', 'v188b', '{"owner":"✓","command":"✓","member":"✗","inactive":"✗"}', 460),
  ('delete', 'field_submission', 'Soft-delete an intelligence record', 'A Bureau Lead or above, with a reason, while nothing depends on it (claim links, verdicts, evidence, cases, observations, a source, SIB handling, messages, intel groups) — archive it instead.', 'public.field_submission_delete → private.field_submission_dependencies', 'v139', '{"owner":"✓","command":"✓","member":"✗","inactive":"✗"}', 470),
  ('undelete', 'field_submission', 'Undelete an intelligence record', 'The Owner only.', 'public.field_submission_undelete', 'v139', '{"owner":"✓","command":"✗","member":"✗","inactive":"✗"}', 480)
on conflict (action, kind) do update set area = excluded.area, rule = excluded.rule,
  enforcing_object = excluded.enforcing_object, test_id = excluded.test_id, matrix = excluded.matrix, sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- 7. rls_test_cleanup — the fixtures' groups go before their records.
-- ---------------------------------------------------------------------------
do $$
declare v_def text; v_anchor text := 'delete from public.field_submissions where officer_id = any(ids) or created_by = any(ids);';
        v_add text := E'delete from public.intel_groups where created_by = any(ids);\n  ';
begin
  v_def := pg_get_functiondef('public.rls_test_cleanup()'::regprocedure);
  if v_def like '%delete from public.intel_groups where created_by = any(ids)%' then return; end if;
  if (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'rls_test_cleanup anchor not found exactly once';
  end if;
  execute replace(v_def, v_anchor, v_add || v_anchor);
end $$;

-- ============================================================================
-- Rollback: drop the three tables and their helpers, the intel_group_* RPCs,
-- field_submission_convert, siu_referred_submissions,
-- private.field_claim_pair_ok / field_claim_submission / field_link_target_ok;
-- re-create field_claim_link, field_submission_repeats,
-- private.field_submission_dependencies and private.perm_dispatch from their
-- previous states; drop the three field_claim_links columns (after deleting
-- rows that use them) and the six source_submission_id columns; delete the
-- ten catalog rows; re-emit rls_test_cleanup without the delete.
-- ============================================================================
