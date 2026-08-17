-- ============================================================================
-- Deconfliction reads the registry, not the typed label.
--
-- 20260903120000 pointed the watchlist at canonical records and let `label` go
-- null for every linked entry. That silently broke public.siu_deconflict(),
-- which is the one query in the unit whose job is to warn an agent that
-- somebody else is already interested. It failed in two directions at once:
--
--   1. It matched watches on `lower(w.label) = lower(p_label)`. A correctly
--      linked watch has NO label, so a name search stopped finding precisely
--      the entries that had been done properly. The better the data got, the
--      more the safety check missed.
--
--   2. It matched `w.status = 'active'` only. The new vocabulary has four live
--      statuses, so a watch stepped down to 'monitor' or flagged 'review_due'
--      disappeared from deconfliction while still being actively monitored.
--
-- Either one produces the same failure in the field: a clean result that is not
-- clean, and two agents working the same subject without knowing it. This is
-- worse than the check being absent, because an absent check is not trusted.
--
-- ── How it matches now ────────────────────────────────────────────────────
-- A typed entity id is matched against the typed foreign key, which is exact.
-- A free-text name is first RESOLVED against the registry — the same lookup
-- the add form performs — and the resolved ids are then matched against the
-- references. The label comparison is kept only for `unknown` rows, which are
-- the only ones that still legitimately hold a typed name.
--
-- Resolution deliberately uses every registry match rather than a single
-- unambiguous one. Two people share a name; a deconfliction check that stayed
-- quiet because the name was ambiguous would be exactly wrong.
--
-- ── What is NOT changed ───────────────────────────────────────────────────
-- Compartmented investigations remain excluded from the hidden count. A hit
-- count is an existence oracle and that exclusion is the deliberate cost
-- documented in 20260831120000. The wording in the UI already refuses to call
-- a zero result proof of anything, and that stays true.
--
-- APPLICATION NOTE: applied live as siu_deconflict_reads_the_registry.
-- ============================================================================

create or replace function public.siu_deconflict(
  p_entity_type text,
  p_entity_id uuid default null,
  p_label text default null
) returns jsonb
language plpgsql stable security definer set search_path to ''
as $$
declare
  v_visible jsonb;
  v_hidden int;
  v_watch jsonb;
  v_ids uuid[] := '{}';
  v_q text := btrim(coalesce(p_label, ''));
begin
  if not private.siu_is_agent() then
    -- Never an error: an error tells a caller the surface exists.
    return jsonb_build_object('access', false);
  end if;
  if p_entity_id is null and v_q = '' then
    raise exception 'name an entity to deconflict';
  end if;

  -- Resolve the search to registry ids. ALL matches, not the best one: if two
  -- people share a name, both are checked. Narrowing here would turn an
  -- ambiguous name into a false all-clear.
  if p_entity_id is not null then
    v_ids := array[p_entity_id];
  else
    if p_entity_type = 'person' then
      select coalesce(array_agg(p.id), '{}') into v_ids from public.persons p
       where lower(btrim(p.name)) = lower(v_q) or lower(btrim(coalesce(p.alias, ''))) = lower(v_q);
    elsif p_entity_type = 'vehicle' then
      select coalesce(array_agg(v.id), '{}') into v_ids from public.vehicles v
       where lower(btrim(v.plate)) = lower(v_q);
    elsif p_entity_type = 'gang' then
      select coalesce(array_agg(g.id), '{}') into v_ids from public.gangs g
       where lower(btrim(g.name)) = lower(v_q);
    elsif p_entity_type = 'place' then
      select coalesce(array_agg(pl.id), '{}') into v_ids from public.places pl
       where lower(btrim(pl.name)) = lower(v_q);
    elsif p_entity_type = 'account' then
      select coalesce(array_agg(a.id), '{}') into v_ids from public.accounts a
       where lower(btrim(coalesce(a.handle, ''))) = lower(v_q)
          or lower(btrim(coalesce(a.display_name, ''))) = lower(v_q);
    elsif p_entity_type = 'indicator' then
      select coalesce(array_agg(i.id), '{}') into v_ids from public.indicators i
       where lower(btrim(i.value)) = lower(v_q);
    end if;
  end if;

  -- Investigations the caller can already see IN FULL. No secret is created by
  -- naming these — they are on the caller's own case list.
  select coalesce(jsonb_agg(jsonb_build_object(
           'case_id', c.id, 'case_number', c.case_number, 'title', c.title,
           'designation', t.designation, 'stage', c.siu_stage) order by c.case_number), '[]'::jsonb)
    into v_visible
    from public.siu_targets t
    join public.cases c on c.id = t.case_id
   where t.cleared_at is null
     and private.siu_case_access(t.case_id)
     and (t.entity_id = any(v_ids)
       or (v_q <> '' and t.entity_type = p_entity_type
           and lower(coalesce(t.label, '')) = lower(v_q)));

  -- Everything else: a COUNT and nothing more. Not the case, not its number,
  -- not the agent working it — naming the agent on a restricted investigation
  -- discloses both the investigation and one of its participants.
  select count(distinct t.case_id) into v_hidden
    from public.siu_targets t
    join public.cases c on c.id = t.case_id
   where t.cleared_at is null
     and not private.siu_case_access(t.case_id)
     and coalesce(c.siu_classification, 'siu') <> 'siu_compartmented'
     and (t.entity_id = any(v_ids)
       or (v_q <> '' and t.entity_type = p_entity_type
           and lower(coalesce(t.label, '')) = lower(v_q)));

  -- The watchlist half. The name is read from the registry, because the watch
  -- no longer stores one; `label` is consulted only for an 'unknown' subject,
  -- which is the sole case where the typed name is still the only name there
  -- is. All four LIVE statuses count — a watch stepped down to monitoring is
  -- still a watch, and hiding it here is how two agents collide.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', w.id,
           'label', coalesce(p.name, v.plate, g.name, pl.name, a.handle, i.value,
                             w.label, 'Unidentified subject'),
           'entity_type', w.entity_type,
           'priority', w.priority, 'status', w.status,
           'expires_at', w.expires_at) order by w.created_at desc), '[]'::jsonb)
    into v_watch
    from public.siu_watchlist w
    left join public.persons    p  on p.id  = w.person_id
    left join public.vehicles   v  on v.id  = w.vehicle_id
    left join public.gangs      g  on g.id  = w.gang_id
    left join public.places     pl on pl.id = w.place_id
    left join public.accounts   a  on a.id  = w.account_id
    left join public.indicators i  on i.id  = w.indicator_id
   where w.status in ('active', 'monitor', 'review_due', 'suspended')
     and w.expires_at > now()
     and (coalesce(w.person_id, w.vehicle_id, w.gang_id, w.place_id,
                   w.account_id, w.indicator_id) = any(v_ids)
       or (v_q <> '' and w.entity_type = 'unknown'
           and lower(coalesce(w.label, '')) = lower(v_q)));

  return jsonb_build_object(
    'access', true,
    'investigations', v_visible,
    'other_interest', v_hidden,
    'coordinate_with', case when v_hidden > 0 then 'SIU command' end,
    'watchlist', v_watch);
end $$;
revoke all on function public.siu_deconflict(text, uuid, text) from public;
revoke execute on function public.siu_deconflict(text, uuid, text) from anon;
grant execute on function public.siu_deconflict(text, uuid, text) to authenticated, service_role;

-- ── The dashboards counted 'active' too ────────────────────────────────────
-- siu_command_dashboard() and siu_oversight_supplement() report watch_active
-- and watch_expiring_14d off `w.status = 'active'`. Under the new vocabulary
-- that undercounts: a watch stepped down to monitoring, or flagged for review,
-- is still being monitored and was dropping out of the unit's own figures —
-- including the figure oversight is given instead of the list itself.
--
-- Both are patched by rewriting only that one predicate in their existing
-- definitions, so nothing else about either function can drift here. The
-- rewrite RAISES if a function's source did not contain the predicate: a
-- source-rewriting migration that quietly matches nothing is worse than one
-- that fails, because it reports success while leaving the bug in place.
do $$
declare v_name text; v_src text; v_new text;
begin
  foreach v_name in array array['siu_command_dashboard', 'siu_oversight_supplement'] loop
    select pg_get_functiondef(p.oid) into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_name;
    if v_src is null then
      raise exception 'public.% is missing — expected it to exist', v_name;
    end if;

    v_new := replace(v_src,
      'w.status = ''active''',
      'w.status in (''active'', ''monitor'', ''review_due'', ''suspended'')');
    if v_new = v_src then
      raise exception 'public.% no longer contains the watch predicate this migration expects', v_name;
    end if;
    execute v_new;
  end loop;
end $$;
