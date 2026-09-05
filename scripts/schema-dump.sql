-- ============================================================================
-- Live schema dump query — the input to scripts/build-schema-snapshot.mjs.
--
-- Purpose
--   Produce ONE JSON document describing the live project's schema from the
--   Postgres catalogs, so supabase/schema-snapshot.sql can be regenerated
--   deterministically instead of being maintained by hand.
--
-- How to use (Owner / maintainer, elevated access — never from the app)
--   1. Run this whole file against the live project (Supabase SQL editor, or
--      the Supabase MCP `execute_sql`). It returns a single row with one
--      column, `dump`, holding the JSON.
--   2. Save that JSON (the value only, not the wrapping row) to
--      supabase/schema-dump.json  (git-ignored — it is an intermediate file).
--   3. Run:  node scripts/build-schema-snapshot.mjs
--      which rewrites supabase/schema-snapshot.sql, then run the gates:
--      npm run check:schema && npm run check:freshness && npm run check:realtime
--
-- Scope: enum types, tables (public + private) with columns and constraints,
-- views, indexes, functions (public + private, non-extension), triggers,
-- RLS policies, realtime publication members, table grants, column ACLs and
-- function ACLs. Read-only; pinned ordering so two dumps of the same schema
-- produce byte-identical output.
-- ============================================================================
select json_build_object(
  'generated_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD'),
  'project_ref', current_setting('request.jwt.claims', true), -- informational; may be null in the SQL editor
  'enums', (
    select json_agg(json_build_object('name', t.typname,
      'labels', (select json_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid))
      order by t.typname)
    from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype = 'e'),
  'tables', (
    select json_agg(json_build_object(
      'schema', n.nspname, 'name', c.relname,
      'rls', c.relrowsecurity, 'forced', c.relforcerowsecurity,
      'columns', (select json_agg(json_build_object(
          'name', a.attname, 'type', format_type(a.atttypid, a.atttypmod),
          'notnull', a.attnotnull, 'default', pg_get_expr(d.adbin, d.adrelid),
          'generated', a.attgenerated, 'identity', a.attidentity) order by a.attnum)
        from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
        where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped),
      'constraints', (select json_agg(json_build_object('name', k.conname, 'type', k.contype, 'def', pg_get_constraintdef(k.oid))
          order by k.contype, k.conname)
        from pg_constraint k where k.conrelid = c.oid)
    ) order by n.nspname, c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and n.nspname in ('public', 'private')),
  'views', (
    select json_agg(json_build_object('name', viewname, 'def', definition) order by viewname)
    from pg_views where schemaname = 'public'),
  'indexes', (
    select json_agg(json_build_object('table', tablename, 'name', indexname, 'def', indexdef) order by tablename, indexname)
    from pg_indexes where schemaname = 'public'),
  'functions', (
    select json_agg(json_build_object('schema', n.nspname, 'name', p.proname,
        'args', pg_get_function_identity_arguments(p.oid), 'def', pg_get_functiondef(p.oid), 'acl', p.proacl::text)
      order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prokind = 'f' and p.proname not like 'pg\_%'),
  'triggers', (
    select json_agg(json_build_object('table', c.relname, 'name', t.tgname, 'def', pg_get_triggerdef(t.oid)) order by c.relname, t.tgname)
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not t.tgisinternal),
  'policies', (
    select json_agg(json_build_object('table', tablename, 'name', policyname, 'permissive', permissive,
        'roles', roles, 'cmd', cmd, 'qual', qual, 'with_check', with_check) order by tablename, policyname)
    from pg_policies where schemaname = 'public'),
  'publication', (
    select json_agg(tablename order by tablename) from pg_publication_tables where pubname = 'supabase_realtime'),
  'grants', (
    select json_agg(json_build_object('table', table_name, 'grantee', grantee, 'privs', privs) order by table_name, grantee)
    from (select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privs
          from information_schema.role_table_grants
          where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')
          group by table_name, grantee) g),
  'column_acl', (
    select json_agg(json_build_object('table', c.relname, 'column', a.attname, 'acl', a.attacl::text) order by c.relname, a.attnum)
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped and a.attacl is not null)
) as dump;
