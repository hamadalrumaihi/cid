-- Owner Security Testing dashboard (v1.14). The browser NEVER runs
-- privileged tests — the live RLS/E2E suites (running as rls-test fixture
-- accounts, locally or in CI) report sanitized results through
-- security_test_report(), and the Owner Portal reads them plus live fixture
-- health through owner_security_overview(). The runs table has NO client
-- grants at all (not even SELECT): the two audited definer RPCs are the only
-- path in or out. No passwords, no service-role key, no SQL console.

create table public.security_test_runs (
  id uuid primary key default gen_random_uuid(),
  suite text not null,
  passed integer not null default 0,
  failed integer not null default 0,
  skipped integer not null default 0,
  total integer not null default 0,
  -- Sanitized failure summaries only: [{name, expected, actual}] — never row
  -- contents, never payloads (enforced in security_test_report()).
  failures jsonb not null default '[]'::jsonb,
  commit_sha text,
  branch text,
  release text,
  source text not null default 'local' check (source in ('ci', 'local')),
  duration_ms integer,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.security_test_runs enable row level security;
-- Full lockdown: definer RPCs only.
revoke select, insert, update, delete on table public.security_test_runs from authenticated, anon;

-- Writer: callable ONLY by the rls-test fixture accounts (rls_test_cleanup
-- precedent) — the suites report their own results at the end of a run.
-- Sanitization is enforced here, not trusted from the caller.
create or replace function public.security_test_report(
  p_suite text, p_passed integer, p_failed integer, p_skipped integer,
  p_failures jsonb default '[]'::jsonb, p_commit text default null,
  p_branch text default null, p_release text default null,
  p_source text default 'local', p_duration_ms integer default null)
returns uuid
language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_test boolean;
  v_failures jsonb := '[]'::jsonb;
  f jsonb;
  v_id uuid;
begin
  select email like 'rls-test-%@cidportal.test' into v_is_test
    from auth.users where id = v_uid;
  if not coalesce(v_is_test, false) then
    raise exception 'security_test_report: caller is not an RLS test account';
  end if;
  if p_suite is null or btrim(p_suite) = '' then raise exception 'a suite name is required'; end if;
  if p_source not in ('ci', 'local') then raise exception 'invalid source'; end if;
  -- Rebuild failures keeping ONLY short name/expected/actual strings (≤30
  -- entries, ≤300 chars each) so sensitive row content can never land here.
  if jsonb_typeof(p_failures) = 'array' then
    for f in select * from jsonb_array_elements(p_failures) limit 30 loop
      v_failures := v_failures || jsonb_build_array(jsonb_build_object(
        'name', left(coalesce(f->>'name', 'unnamed test'), 300),
        'expected', left(coalesce(f->>'expected', ''), 300),
        'actual', left(coalesce(f->>'actual', ''), 300)));
    end loop;
  end if;
  insert into public.security_test_runs
    (suite, passed, failed, skipped, total, failures, commit_sha, branch, release, source, duration_ms, created_by)
  values (btrim(p_suite), greatest(coalesce(p_passed, 0), 0), greatest(coalesce(p_failed, 0), 0),
          greatest(coalesce(p_skipped, 0), 0),
          greatest(coalesce(p_passed, 0), 0) + greatest(coalesce(p_failed, 0), 0) + greatest(coalesce(p_skipped, 0), 0),
          v_failures, left(coalesce(p_commit, ''), 64), left(coalesce(p_branch, ''), 120),
          left(coalesce(p_release, ''), 40), p_source, p_duration_ms, v_uid)
  returning id into v_id;
  -- Retention: keep the newest 50 runs per suite.
  delete from public.security_test_runs s
   where s.suite = btrim(p_suite)
     and s.id not in (select id from public.security_test_runs
                      where suite = btrim(p_suite) order by created_at desc limit 50);
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'SECURITY_TEST_REPORTED', 'security_test_runs', v_id,
          jsonb_build_object('suite', btrim(p_suite), 'passed', p_passed, 'failed', p_failed, 'source', p_source));
  return v_id;
end $$;
revoke all on function public.security_test_report(text, integer, integer, integer, jsonb, text, text, text, text, integer) from public;
grant execute on function public.security_test_report(text, integer, integer, integer, jsonb, text, text, text, text, integer) to authenticated, service_role;

-- Reader: Owner only. Returns recent runs plus LIVE fixture-health checks —
-- expected fixture roster vs actual profiles/justice memberships, and
-- leftover test-data counts (a crashed run's residue).
-- (volatile: it writes an audit-log row on every view)
create or replace function public.owner_security_overview()
returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  v_runs jsonb;
  v_fixtures jsonb;
  v_leftovers jsonb;
  test_ids uuid[];
begin
  if not private.is_owner() then raise exception 'not authorized'; end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb) into v_runs
    from (select id, suite, passed, failed, skipped, total, failures, commit_sha,
                 branch, release, source, duration_ms, created_at
            from public.security_test_runs
           order by created_at desc limit 20) r;

  -- Expected fixture roster (kept in sync with tests/rls/README.md).
  with expected(email, kind, exp_role, exp_division, exp_cid_active, exp_justice_role, exp_justice_active) as (values
    ('rls-test-lsb@cidportal.test', 'cid', 'detective', 'LSB', true, null, null),
    ('rls-test-bcb@cidportal.test', 'cid', 'detective', 'BCB', true, null, null),
    ('rls-test-inactive@cidportal.test', 'cid', null, null, false, null, null),
    ('rls-test-owner@cidportal.test', 'cid', 'detective', 'SAB', true, null, null),
    ('rls-test-lead@cidportal.test', 'cid', 'bureau_lead', 'LSB', true, null, null),
    ('rls-test-director@cidportal.test', 'cid', 'director', 'SAB', true, null, null),
    ('rls-test-target@cidportal.test', 'cid', 'detective', 'LSB', true, null, null),
    ('rls-test-applicant@cidportal.test', 'cid', null, null, false, null, null),
    ('rls-test-ada-lsb@cidportal.test', 'justice', null, null, false, 'assistant_district_attorney', true),
    ('rls-test-ada-bcb@cidportal.test', 'justice', null, null, false, 'assistant_district_attorney', true),
    ('rls-test-ada-sab@cidportal.test', 'justice', null, null, false, 'assistant_district_attorney', true),
    ('rls-test-da@cidportal.test', 'justice', null, null, false, 'district_attorney', true),
    ('rls-test-ag@cidportal.test', 'justice', null, null, false, 'attorney_general', true),
    ('rls-test-judge@cidportal.test', 'justice', null, null, false, 'judge', true),
    ('rls-test-judge2@cidportal.test', 'justice', null, null, false, 'judge', true),
    ('rls-test-justice@cidportal.test', 'justice', null, null, false, null, null))
  select coalesce(jsonb_agg(jsonb_build_object(
           'email', e.email,
           'present', u.id is not null,
           'issues', (
             select coalesce(jsonb_agg(issue), '[]'::jsonb) from (
               select 'missing account' as issue where u.id is null
               union all select 'missing profile' where u.id is not null and p.id is null
               union all select 'unexpected CID role: ' || p.role::text
                 where p.id is not null and e.exp_role is not null and p.role::text is distinct from e.exp_role
               union all select 'unexpected bureau: ' || p.division::text
                 where p.id is not null and e.exp_division is not null and p.division::text is distinct from e.exp_division
               union all select 'CID active flag is ' || p.active::text
                 where p.id is not null and e.exp_cid_active is not null and p.active is distinct from e.exp_cid_active
               union all select 'login denied' where coalesce(p.login_denied, false)
               union all select 'removed' where p.removed_at is not null
               union all select 'unexpected justice role: ' || coalesce(jm.justice_role, 'none')
                 where u.id is not null and e.kind = 'justice'
                   and coalesce(jm.justice_role, '') is distinct from coalesce(e.exp_justice_role, '')
               union all select 'justice membership inactive'
                 where e.exp_justice_active is true and coalesce(jm.active, false) = false
             ) issues)) order by e.email), '[]'::jsonb)
    into v_fixtures
    from expected e
    left join auth.users u on u.email = e.email
    left join public.profiles p on p.id = u.id
    left join public.justice_memberships jm on jm.user_id = u.id;

  select coalesce(array_agg(id), '{}') into test_ids
    from auth.users where email like 'rls-test-%@cidportal.test';
  select jsonb_build_object(
    'cases', (select count(*) from public.cases where created_by = any(test_ids)),
    'legal_requests', (select count(*) from public.legal_requests where created_by = any(test_ids)),
    'prosecutor_assignments', (select count(*) from public.prosecutor_bureau_assignments
                                where (prosecutor_id = any(test_ids) or assigned_by = any(test_ids)) and ends_at is null),
    'announcements', (select count(*) from public.announcements where author_id = any(test_ids)),
    'membership_requests', (select count(*) from public.membership_requests where applicant_id = any(test_ids)),
    'justice_requests', (select count(*) from public.justice_membership_requests where applicant_id = any(test_ids)),
    'persons', (select count(*) from public.persons where created_by = any(test_ids)))
    into v_leftovers;

  insert into public.audit_log (actor_id, action, entity, entity_id)
  values ((select auth.uid()), 'SECURITY_OVERVIEW_VIEWED', 'security_test_runs', null);

  return jsonb_build_object('runs', v_runs, 'fixtures', v_fixtures, 'leftovers', v_leftovers);
end $$;
revoke all on function public.owner_security_overview() from public;
grant execute on function public.owner_security_overview() to authenticated, service_role;
