-- ─────────────────────────────────────────────────────────────────────────────
-- Prosecutor-assignment fixture guard + audited replacement.
--
-- The live RLS suites exercise ADA routing against the real bureaus, and
-- assign_ada_to_bureau's replace path (p_replace default true) ends ANY live
-- primary/acting assignment for the bureau — including a real prosecutor's.
-- Between 2026-07-14 and 2026-07-17 this silently terminated the real SAB
-- primary assignment three times within minutes of test runs, leaving the
-- division with no prosecutor coverage and seven submitted warrants parked
-- at DOJ with no visible owner. Teardown-based restoration cannot fix this
-- class (a crashed run never reaches teardown), so the server now refuses:
--   * a test-fixture caller (profiles.is_test) may not REPLACE a live
--     assignment held by a real prosecutor (fixture-vs-fixture stays legal,
--     so every existing test scenario still works);
--   * a test-fixture caller may not END a real prosecutor's assignment via
--     end_ada_bureau_assignment either.
-- Independently of fixtures, the replace path previously ended the displaced
-- assignment with no audit row and no notification to the replaced
-- prosecutor — it now writes ADA_ASSIGNMENT_ENDED (detail carries
-- replaced_by) and notifies the displaced prosecutor, matching
-- end_ada_bureau_assignment. Real DA/AG/Owner flows are otherwise unchanged.
--
-- Previous bodies: supabase/migrations/20260714020000_prosecutor_assignments.sql
-- (verified byte-identical to the live definitions before this replacement).
-- ─────────────────────────────────────────────────────────────────────────────

-- Defensive alignment (verified already true in prod: 16/16 fixtures flagged,
-- zero non-fixtures flagged): every rls-test account carries is_test.
update public.profiles p
   set is_test = true
  from auth.users u
 where u.id = p.id
   and u.email like 'rls-test-%@cidportal.test'
   and not p.is_test;

create or replace function public.assign_ada_to_bureau(
  p_prosecutor uuid, p_bureau public.bureau, p_type text default 'supporting',
  p_note text default null, p_replace boolean default true)
returns public.prosecutor_bureau_assignments
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); a public.prosecutor_bureau_assignments;
        v_actor_name text; v_is_test boolean;
        v_actor_is_test boolean := coalesce((select is_test from public.profiles where id = (select auth.uid())), false);
        displaced record;
begin
  if not private.can_manage_prosecutors() then
    raise exception 'only a District Attorney, Attorney General, or the Owner may manage ADA assignments';
  end if;
  if p_type not in ('primary', 'supporting', 'acting') then raise exception 'invalid assignment type'; end if;
  if p_prosecutor = v_uid and not coalesce((select is_owner from public.profiles where id = v_uid), false)
     and p_type in ('primary', 'acting') then
    raise exception 'you cannot make yourself the routing prosecutor';
  end if;
  perform private.pba_validate(p_prosecutor, p_bureau, p_type);
  if exists (select 1 from public.prosecutor_bureau_assignments
             where prosecutor_id = p_prosecutor and bureau = p_bureau
               and assignment_type = p_type and ends_at is null) then
    raise exception 'that assignment already exists';
  end if;
  select display_name into v_actor_name from public.profiles where id = v_uid;
  if p_type in ('primary', 'acting') then
    -- At most one live row per (bureau, type) — enforced by the partial
    -- unique indexes one_active_primary/acting_ada_per_bureau.
    select b.id, b.prosecutor_id, coalesce(bp.is_test, false) as pros_is_test
      into displaced
      from public.prosecutor_bureau_assignments b
      left join public.profiles bp on bp.id = b.prosecutor_id
     where b.bureau = p_bureau and b.assignment_type = p_type and b.ends_at is null;
    if displaced.id is not null then
      if not p_replace then
        raise exception 'an active % assignment already exists for %', p_type, p_bureau;
      end if;
      if v_actor_is_test and not displaced.pros_is_test then
        raise exception 'test fixtures may not replace the live % assignment for % held by a real prosecutor', p_type, p_bureau;
      end if;
      update public.prosecutor_bureau_assignments
         set ends_at = now()
       where id = displaced.id;
      insert into public.audit_log (actor_id, action, entity, entity_id, detail)
      values (v_uid, 'ADA_ASSIGNMENT_ENDED', 'prosecutor_bureau_assignments', displaced.id,
              jsonb_build_object('prosecutor_id', displaced.prosecutor_id, 'bureau', p_bureau,
                'type', p_type, 'replaced_by', p_prosecutor));
      if not displaced.pros_is_test then
        insert into public.notifications (user_id, type, payload)
        values (displaced.prosecutor_id, 'ada_assignment', jsonb_build_object(
          'assignment_id', displaced.id, 'bureau', p_bureau, 'assignment_type', p_type, 'ended', true,
          'reason', 'Your ' || p_type || ' assignment for ' || p_bureau || ' has ended (replaced).',
          'actor_id', v_uid, 'actor_name', v_actor_name));
      end if;
    end if;
  end if;
  insert into public.prosecutor_bureau_assignments
    (prosecutor_id, bureau, assignment_type, assigned_by, assignment_note)
  values (p_prosecutor, p_bureau, p_type, v_uid, nullif(btrim(coalesce(p_note, '')), ''))
  returning * into a;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'ADA_ASSIGNED', 'prosecutor_bureau_assignments', a.id,
          jsonb_build_object('prosecutor_id', p_prosecutor, 'bureau', p_bureau, 'type', p_type));
  select email like 'rls-test-%@cidportal.test' into v_is_test from auth.users where id = p_prosecutor;
  if not coalesce(v_is_test, false) then
    insert into public.notifications (user_id, type, payload)
    values (p_prosecutor, 'ada_assignment', jsonb_build_object(
      'assignment_id', a.id, 'bureau', p_bureau, 'assignment_type', p_type,
      'reason', 'You are now the ' || p_type || ' prosecutor for ' || p_bureau || '.',
      'actor_id', v_uid, 'actor_name', v_actor_name));
  end if;
  return a;
end $$;
revoke all on function public.assign_ada_to_bureau(uuid, public.bureau, text, text, boolean) from public;
revoke execute on function public.assign_ada_to_bureau(uuid, public.bureau, text, text, boolean) from anon;
grant execute on function public.assign_ada_to_bureau(uuid, public.bureau, text, text, boolean) to authenticated, service_role;

create or replace function public.end_ada_bureau_assignment(p_assignment uuid, p_note text default null)
returns public.prosecutor_bureau_assignments
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); a public.prosecutor_bureau_assignments;
        v_actor_name text; v_is_test boolean;
        v_actor_is_test boolean := coalesce((select is_test from public.profiles where id = (select auth.uid())), false);
begin
  if not private.can_manage_prosecutors() then
    raise exception 'only a District Attorney, Attorney General, or the Owner may manage ADA assignments';
  end if;
  select * into a from public.prosecutor_bureau_assignments where id = p_assignment for update;
  if not found then raise exception 'assignment not found'; end if;
  if a.ends_at is not null then raise exception 'assignment already ended'; end if;
  if v_actor_is_test
     and not coalesce((select is_test from public.profiles where id = a.prosecutor_id), false) then
    raise exception 'test fixtures may not end a real prosecutor''s assignment';
  end if;
  update public.prosecutor_bureau_assignments
     set ends_at = now(),
         assignment_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), assignment_note)
   where id = p_assignment returning * into a;
  select display_name into v_actor_name from public.profiles where id = v_uid;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'ADA_ASSIGNMENT_ENDED', 'prosecutor_bureau_assignments', a.id,
          jsonb_build_object('prosecutor_id', a.prosecutor_id, 'bureau', a.bureau, 'type', a.assignment_type));
  select email like 'rls-test-%@cidportal.test' into v_is_test from auth.users where id = a.prosecutor_id;
  if not coalesce(v_is_test, false) then
    insert into public.notifications (user_id, type, payload)
    values (a.prosecutor_id, 'ada_assignment', jsonb_build_object(
      'assignment_id', a.id, 'bureau', a.bureau, 'assignment_type', a.assignment_type, 'ended', true,
      'reason', 'Your ' || a.assignment_type || ' assignment for ' || a.bureau || ' has ended.',
      'actor_id', v_uid, 'actor_name', v_actor_name));
  end if;
  return a;
end $$;
revoke all on function public.end_ada_bureau_assignment(uuid, text) from public;
revoke execute on function public.end_ada_bureau_assignment(uuid, text) from anon;
grant execute on function public.end_ada_bureau_assignment(uuid, text) to authenticated, service_role;
