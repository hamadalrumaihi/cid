-- Reset + seed for the DEDICATED test Supabase project. Idempotent and safe to
-- re-run: it wipes synthetic content, re-asserts the six role accounts, and
-- inserts a small fixed fixture so screens render deterministically.
--
-- NEVER run against production. The wrapper (scripts/test-seed.mjs) refuses if
-- the connection points at the prod project ref; this file assumes a test DB.
--
-- Passwords arrive as psql variables (:'pw_detective' …) from env, so no
-- secret is written here. Triggers are bypassed for the account upsert so the
-- guard_profile freeze doesn't block seeding role / is_owner.

\set ON_ERROR_STOP on
begin;

-- 1) Wipe synthetic content (CASCADE handles FK order). Leaves profiles/auth
--    intact — those are re-asserted below. Extend this list as the fixture grows.
truncate table
  public.cases,
  public.persons,
  public.gangs,
  public.operations,
  public.commendations,
  public.notifications,
  public.role_events,
  public.audit_log
restart identity cascade;

-- 2) Re-assert the six accounts (auth user + identity + profile). Bypass
--    triggers so guard_profile doesn't revert role / division / is_owner.
set session_replication_role = replica;

-- Insert any missing users. Existing users are left in place here; their
-- passwords are refreshed by the UPDATE below (keeps re-runs idempotent).
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
  s.email, crypt(s.pw, gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', s.full_name),
  now(), now(), '', '', '', '', '', '', '', ''
from (values
  ('test-detective@cidportal.test', 'Test Detective', :'pw_detective'),
  ('test-senior@cidportal.test',    'Test Senior',    :'pw_senior'),
  ('test-lead@cidportal.test',      'Test Lead',      :'pw_lead'),
  ('test-deputy@cidportal.test',    'Test Deputy',    :'pw_deputy'),
  ('test-director@cidportal.test',  'Test Director',  :'pw_director'),
  ('test-owner@cidportal.test',     'Test Owner',     :'pw_owner')
) as s(email, full_name, pw)
on conflict (email) do nothing;

-- Refresh passwords for any pre-existing users (idempotent re-runs).
update auth.users u
set encrypted_password = crypt(s.pw, gen_salt('bf')), updated_at = now()
from (
  values
    ('test-detective@cidportal.test', :'pw_detective'),
    ('test-senior@cidportal.test',    :'pw_senior'),
    ('test-lead@cidportal.test',      :'pw_lead'),
    ('test-deputy@cidportal.test',    :'pw_deputy'),
    ('test-director@cidportal.test',  :'pw_director'),
    ('test-owner@cidportal.test',     :'pw_owner')
) as s(email, pw)
where u.email = s.email;

-- Identities (GoTrue requires one per email user).
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
from auth.users u
where u.email like '%@cidportal.test'
  and not exists (select 1 from auth.identities i where i.user_id = u.id);

-- Profiles: role / division / is_owner / active per the seed matrix.
update public.profiles p
set role = s.role::app_role, division = s.division::bureau, is_owner = s.is_owner, active = true
from (
  values
    ('test-detective@cidportal.test', 'detective',        'LSB', false),
    ('test-senior@cidportal.test',    'senior_detective', 'LSB', false),
    ('test-lead@cidportal.test',      'bureau_lead',      'LSB', false),
    ('test-deputy@cidportal.test',    'deputy_director',  'SAB', false),
    ('test-director@cidportal.test',  'director',         'SAB', false),
    ('test-owner@cidportal.test',     'director',         'SAB', true)
) as s(email, role, division, is_owner)
where p.email = s.email;

set session_replication_role = default;

-- 3) Minimal synthetic fixture so registries/dashboards aren't all empty.
insert into public.persons (id, name, status, created_by)
select gen_random_uuid(), 'John Doe (test)', 'active', p.id
from public.profiles p where p.email = 'test-detective@cidportal.test';

insert into public.gangs (id, name, created_by)
select gen_random_uuid(), 'Test Syndicate', p.id
from public.profiles p where p.email = 'test-detective@cidportal.test';

insert into public.cases (id, case_number, title, summary, status, bureau, created_by, lead_detective_id)
select gen_random_uuid(), 'TEST-0001', 'Fixture case', 'A synthetic case for tests.', 'open', 'LSB', p.id, p.id
from public.profiles p where p.email = 'test-detective@cidportal.test';

commit;
