-- ─────────────────────────────────────────────────────────────────────────────
-- Merge RPCs learn the tables added after they were written.
--
-- person_merge (authored 20260729) predates the narcotics link tables
-- (20260803): a merged person's supplier/courier roles stayed on the
-- tombstone and vanished from the survivor's dossier. merge_narcotics
-- (20260803) predates the street-value sales tables (20260804): a merged
-- substance's sale series/observations stranded the same way. Live checks
-- found ZERO stranded rows today, so this is purely preventive — no
-- backfill needed.
--
-- Both functions are patched via anchor-verified dynamic re-emission of the
-- current definition (the patch aborts loudly if the body drifted), which is
-- also replay-safe on a fresh rebuild: the anchors exist in the freshly
-- authored versions too.
-- ─────────────────────────────────────────────────────────────────────────────

do $mig$
declare src text;
begin
  -- person_merge: repoint narcotic_persons (UNIQUE(narcotic_id, person_id,
  -- role) — drop merged-side links the survivor already holds, move the rest).
  src := pg_get_functiondef('public.person_merge(uuid, uuid[], text)'::regprocedure);
  if position($a$update public.watchlist set target_id = p_survivor
     where target_type = 'person' and target_id = v_victim;$a$ in src) = 0 then
    raise exception 'person_merge anchor missing — live body drifted, abort';
  end if;
  src := replace(src,
$a$update public.watchlist set target_id = p_survivor
     where target_type = 'person' and target_id = v_victim;$a$,
$a$delete from public.narcotic_persons np
     where np.person_id = v_victim
       and exists (select 1 from public.narcotic_persons keep
                   where keep.narcotic_id = np.narcotic_id and keep.person_id = p_survivor
                     and keep.role is not distinct from np.role);
    update public.narcotic_persons set person_id = p_survivor where person_id = v_victim;

    update public.watchlist set target_id = p_survivor
     where target_type = 'person' and target_id = v_victim;$a$);
  execute src;

  -- merge_narcotics: repoint the street-value study (no unique keys on
  -- narcotic_id — plain moves).
  src := pg_get_functiondef((
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'merge_narcotics'));
  if position($a$update public.places set narcotic_id = p_survivor where narcotic_id = p_merged;
  get diagnostics n_plc = row_count;$a$ in src) = 0 then
    raise exception 'merge_narcotics anchor missing — live body drifted, abort';
  end if;
  src := replace(src,
$a$update public.places set narcotic_id = p_survivor where narcotic_id = p_merged;
  get diagnostics n_plc = row_count;$a$,
$a$update public.places set narcotic_id = p_survivor where narcotic_id = p_merged;
  get diagnostics n_plc = row_count;
  update public.narcotic_sale_series set narcotic_id = p_survivor where narcotic_id = p_merged;
  update public.narcotic_sale_observations set narcotic_id = p_survivor where narcotic_id = p_merged;$a$);
  execute src;
end $mig$;
