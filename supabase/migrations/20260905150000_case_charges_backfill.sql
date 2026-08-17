-- ============================================================================
-- The 29 charges already on cases become records, under the code that was in
-- force when they were brought.
--
-- Six cases carry charges in `cases.charges` as {code, count}. Every code is a
-- legacy one -- (1)09, (4)22, (10)01 -- so each resolves against the
-- superseded legacy version imported in 20260905120000, not against the 2026
-- code. That is the entire point of freezing them as snapshots: a case that
-- charged Attempted Murder at 60 months keeps saying 60 months, whatever a
-- later version renumbers or reprices.
--
-- ── They are imported as 'proposed', and that is a deliberate understatement
-- The old model had no status at all. It recorded that a charge was attached
-- to a case and nothing more -- not whether it was reviewed, filed, or proved.
-- Any richer status would be an invention: marking them 'filed' would assert a
-- court event that may never have happened, and 'convicted' would assert a
-- finding against a named person that no judge made.
--
-- 'proposed' is the floor of what the data actually supports. To stop anyone
-- reading it as a judgement, every migrated row carries a note saying where it
-- came from and that the source held no status. A charge that really did go to
-- court can be walked forward through the normal workflow by the people
-- entitled to move it.
--
-- ── added_by is NULL, on purpose ──────────────────────────────────────────
-- The jsonb array does not record who added a charge or when. Attributing
-- these to whoever happens to run the migration, or to the case's lead, would
-- put a name against an act that person may not have performed. NULL is the
-- true answer and the column allows it.
--
-- ── RICO rows are migrated, and that is not a hole ────────────────────────
-- Two cases already carry (10)01 RICO Conspiracy, which a detective could not
-- add today: the insert policy reserves RICO modifiers to a prosecutor or
-- judge. That restriction governs bringing a NEW charge, and this migration
-- brings none -- it records charges that already exist on those cases. It runs
-- as the migration role and so is not subject to the policy; refusing them
-- would silently drop two real charges from the record in the name of a rule
-- about who may create one.
--
-- ── Duplicate codes inside one case ───────────────────────────────────────
-- The array could hold the same code twice; the new table permits one live row
-- per charge per case, with multiplicity in `counts`. Rows are therefore
-- aggregated by code first and their counts summed, which is what two entries
-- for one offense meant anyway.
--
-- ── Idempotent, and additive only ─────────────────────────────────────────
-- Nothing is inserted where a row for that (case, charge) already exists, so
-- re-running changes nothing. `cases.charges` is NOT modified, emptied or
-- deprecated here: the portal still reads it, and it stays the live source
-- until the selectors move in a later step. For now the two coexist, which is
-- deliberate -- a backfill that also cut over the UI would be untestable.
--
-- APPLICATION NOTE: applied live as case_charges_backfill.
-- ============================================================================

do $backfill$
declare
  v_legacy uuid;
  v_missing text[];
  n_before int;
  n_after int;
begin
  select id into v_legacy from public.penal_code_versions
   where name = 'San Andreas Penal Code (legacy)';
  if v_legacy is null then
    raise exception 'the legacy penal code version is missing; 20260905120000 must run first';
  end if;

  -- Refuse to run a partial backfill. If any code on a case does not resolve,
  -- stop and name it rather than silently importing the rest: a case whose
  -- charges are half-migrated is worse than one that has not been touched,
  -- because it looks complete.
  select coalesce(array_agg(distinct e.code), '{}') into v_missing
    from (select jsonb_array_elements(c.charges) ->> 'code' as code
            from public.cases c
           where c.charges is not null and jsonb_array_length(c.charges) > 0) e
   where e.code is not null
     and not exists (select 1 from public.penal_charges pc
                      where pc.version_id = v_legacy and pc.code = e.code);
  if array_length(v_missing, 1) > 0 then
    raise exception 'these case charge codes do not exist in the legacy penal code: %',
      array_to_string(v_missing, ', ');
  end if;

  select count(*) into n_before from public.case_charges;

  insert into public.case_charges
    (case_id, charge_id, version_id, counts, snap_offense, snap_charge_class, note)
  select src.case_id, pc.id, v_legacy, least(src.counts, 999),
         -- snap_offense / snap_charge_class are NOT NULL, so they need a value
         -- to get past the column constraints; the BEFORE INSERT trigger
         -- overwrites both from the canonical charge row a moment later. These
         -- placeholders never reach storage.
         'migrated', 'Felony',
         'Migrated from cases.charges, which recorded no status, no author and '
         || 'no date. Imported as proposed because that is the least the source '
         || 'supports -- it is not a finding that this charge was filed or proved.'
    from (
      select c.id as case_id,
             e.value ->> 'code' as code,
             sum(greatest(1, coalesce((e.value ->> 'count')::int, 1)))::int as counts
        from public.cases c
        cross join lateral jsonb_array_elements(c.charges) e
       where c.charges is not null and jsonb_array_length(c.charges) > 0
         and e.value ->> 'code' is not null
       group by c.id, e.value ->> 'code'
    ) src
    join public.penal_charges pc
      on pc.version_id = v_legacy and pc.code = src.code
   where not exists (
     select 1 from public.case_charges cc
      where cc.case_id = src.case_id and cc.charge_id = pc.id);

  select count(*) into n_after from public.case_charges;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (null, 'CASE_CHARGES_BACKFILLED', 'case_charges', null,
          jsonb_build_object(
            'source', 'cases.charges',
            'version', 'San Andreas Penal Code (legacy)',
            'rows_added', n_after - n_before,
            'cases', (select count(distinct case_id) from public.case_charges),
            'note', 'Imported as proposed; the source recorded no status.'));
end $backfill$;

-- ============================================================================
-- Rollback: delete from public.case_charges where added_by is null and note
-- like 'Migrated from cases.charges%'. cases.charges was never altered, so
-- nothing else needs undoing.
-- ============================================================================
