-- ─────────────────────────────────────────────────────────────────────────────
-- Legal hold → PRESERVATION LOCK (spec D7, batch-15).
--
-- 20260807190000_legal_hold gave a Lead+ the power to place a hold that blocks
-- the Owner-only permanent purge. That protected the case row itself, but a
-- held case's evidence could still be quietly dismantled around it: a case
-- could be ARCHIVED out of view, its media/reports/tasks DELETED, and a linked
-- person or narcotic MERGED into a tombstone. This migration turns an active
-- hold into a full preservation lock by adding a hold check at every remaining
-- destructive chokepoint, reusing the SINGLE reusable predicate
-- private.case_has_active_hold(uuid) everywhere (never re-implementing it):
--
--   1. public.case_archive — refuses to archive a held case (case_restore is
--      untouched: a held case may still be un-archived).
--   2. media_del / reports_del / case_tasks_del RLS — a row whose case is held
--      cannot be DELETEd. media.case_id is nullable, so person/vehicle/narcotic
--      media (case_id IS NULL) stays deletable; only case-attached media locks.
--   3. case_intel_links BEFORE UPDATE OR DELETE trigger — freezes a held case's
--      intel links: a DELETE, or an UPDATE that re-points a link (ref_id/case_id/
--      kind), is rejected while the case is held. person_merge / merge_narcotics
--      repoint/delete the victim's link, so this aborts the merge (the large RPCs
--      are NOT re-emitted); benign role/note edits and INSERTs still pass.
--   4. public.search_all — a held case's result is flagged with a 🔒 marker in
--      its sublabel so command sees the lock in the palette.
--
-- Additive only: no drops of tables/columns, no data deletes. The three DELETE
-- policies are DROP+CREATEd to append the hold clause (RLS policies can only be
-- replaced, not altered). The predicate is SECURITY DEFINER and retains its
-- default PUBLIC execute, so it is callable from INVOKER RLS and from the
-- INVOKER search_all body alike.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. case_archive: refuse a held case ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.case_archive(p_case uuid, p_note text DEFAULT NULL::text)
 RETURNS cases LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare c public.cases; v_uid uuid := (select auth.uid());
begin
  if not private.is_command() then raise exception 'archiving a case is a command action'; end if;
  select * into c from public.cases where id = p_case for update;
  if not found then raise exception 'case not found'; end if;
  if private.case_has_active_hold(p_case) then
    raise exception 'this case is under an active legal hold and cannot be archived — lift the hold first';
  end if;
  if c.archived_at is not null then raise exception 'this case is already archived'; end if;
  update public.cases set archived_at = now(), archived_by = v_uid, updated_at = now()
   where id = p_case returning * into c;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'CASE_ARCHIVED', 'cases', p_case,
          jsonb_build_object('case_number', c.case_number, 'note', nullif(btrim(coalesce(p_note, '')), '')));
  return c;
end $function$;
revoke all on function public.case_archive(uuid, text) from public;
revoke execute on function public.case_archive(uuid, text) from anon;
grant execute on function public.case_archive(uuid, text) to authenticated, service_role;

-- ── 2. DELETE policies: a held case's rows cannot be deleted ──────────────────
-- media.case_id is NULLABLE (person/vehicle/narcotic media) — those rows stay
-- deletable; only case-attached media under a held case locks.
drop policy if exists media_del on public.media;
create policy media_del on public.media
  for delete to authenticated
  using (private.can_delete() and (case_id is null or not private.case_has_active_hold(case_id)));

-- reports.case_id is NOT NULL.
drop policy if exists reports_del on public.reports;
create policy reports_del on public.reports
  for delete to authenticated
  using (private.can_delete() and not private.case_has_active_hold(case_id));

-- case_tasks: creator OR can_delete, then gated by the hold.
drop policy if exists case_tasks_del on public.case_tasks;
create policy case_tasks_del on public.case_tasks
  for delete to authenticated
  using ((private.can_delete() or created_by = (select auth.uid()))
         and not private.case_has_active_hold(case_id));

-- ── 3. Block merge-under-hold at the intel-link chokepoint ────────────────────
-- person_merge / merge_narcotics REPOINT (update ref_id) or DELETE the victim's
-- case_intel_links row BEFORE they tombstone the victim, so a trigger on the
-- persons/narcotics tombstone transition never fires on the real RPC path.
-- Instead freeze a held case's intel links directly: any DELETE, or any UPDATE
-- that re-identifies a link (changes ref_id / case_id / kind — i.e. a merge
-- repoint or a move), is rejected when the link's case is held. That aborts the
-- merge transaction (merging a held-linked entity away MUST touch that link) and
-- also preserves the held case's related records. INSERTs and benign edits
-- (role / note) are untouched — a held case can still gain links and be
-- annotated. Plain (non-definer) trigger fn; it calls the SECURITY DEFINER
-- predicate for the privileged legal_holds read, and fires under the merge RPCs'
-- definer context (Postgres runs triggers regardless of the writer's role).
create or replace function private.block_intel_link_change_under_hold()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if tg_op = 'DELETE' then
    if private.case_has_active_hold(old.case_id) then
      raise exception 'case is under an active legal hold — its intelligence links are preserved and cannot be removed (including by a merge) until the hold is lifted';
    end if;
    return old;
  end if;
  -- UPDATE: only a re-identification (merge repoint / move) is blocked; a role
  -- or note edit on the same link is allowed.
  if (new.ref_id is distinct from old.ref_id
      or new.case_id is distinct from old.case_id
      or new.kind is distinct from old.kind)
     and private.case_has_active_hold(old.case_id) then
    raise exception 'case is under an active legal hold — its intelligence links are preserved and cannot be re-pointed (including by a merge) until the hold is lifted';
  end if;
  return new;
end $function$;
revoke all on function private.block_intel_link_change_under_hold() from public;

drop trigger if exists case_intel_links_block_change_under_hold on public.case_intel_links;
create trigger case_intel_links_block_change_under_hold
  before update or delete on public.case_intel_links
  for each row execute function private.block_intel_link_change_under_hold();

-- ── 4. search_all: flag a held case in its result sublabel ────────────────────
-- Re-emitted VERBATIM from 20260807230000_search_include_accounts with ONLY the
-- kind='case' branch's sublabel changed to fold a 🔒 marker in when the case is
-- held. SECURITY INVOKER and the 6-column signature are unchanged; the marker
-- read goes through the SECURITY DEFINER predicate (default PUBLIC execute).
create or replace function public.search_all(q text)
returns table(kind text, id uuid, label text, sublabel text, term text, rank real)
language sql
stable
set search_path to 'public', 'extensions'
as $function$
  with p as (select lower(trim(q)) as lq, '%' || trim(q) || '%' as lk, 0.3::real as thr)
  select kind, id, label, sublabel, term, rank from (
    select *, row_number() over (partition by kind order by rank desc, label) as rn from (
      select 'case'::text as kind, c.id,
             c.case_number || ' · ' || coalesce(c.title, '') as label,
             (case when private.case_has_active_hold(c.id) then '🔒 Legal hold · ' else '' end
              || left(coalesce(c.summary, ''), 90)) as sublabel, null::text as term,
             greatest(word_similarity(p.lq, lower(coalesce(c.title, ''))),
                      word_similarity(p.lq, lower(c.case_number)),
                      case when c.case_number ilike p.lk or c.title ilike p.lk or c.summary ilike p.lk then 0.95 else 0 end) as rank
      from public.cases c, p
      where p.lq <> '' and (c.case_number ilike p.lk or c.title ilike p.lk or c.summary ilike p.lk
            or word_similarity(p.lq, lower(c.case_number || ' ' || coalesce(c.title, ''))) > p.thr)
      union all
      select 'person', pe.id, pe.name || coalesce(' “' || pe.alias || '”', ''), coalesce(pe.status, ''), pe.name,
             greatest(word_similarity(p.lq, lower(pe.name)), word_similarity(p.lq, lower(coalesce(pe.alias, ''))),
                      case when pe.name ilike p.lk or pe.alias ilike p.lk or pe.status ilike p.lk then 0.95 else 0 end)
      from public.persons pe, p
      where pe.lifecycle is distinct from 'merged'
        and p.lq <> '' and (pe.name ilike p.lk or pe.alias ilike p.lk or pe.status ilike p.lk
            or word_similarity(p.lq, lower(pe.name || ' ' || coalesce(pe.alias, ''))) > p.thr)
      union all
      select 'gang', g.id, g.name, coalesce(g.colors, ''), g.name,
             greatest(word_similarity(p.lq, lower(g.name)),
                      case when g.name ilike p.lk or g.colors ilike p.lk or g.notes ilike p.lk then 0.95 else 0 end)
      from public.gangs g, p
      where p.lq <> '' and (g.name ilike p.lk or g.colors ilike p.lk or g.notes ilike p.lk
            or word_similarity(p.lq, lower(g.name)) > p.thr)
      union all
      select 'place', pl.id, pl.name, coalesce(pl.area, ''), pl.name,
             greatest(word_similarity(p.lq, lower(pl.name)),
                      case when pl.name ilike p.lk or pl.area ilike p.lk then 0.95 else 0 end)
      from public.places pl, p
      where p.lq <> '' and (pl.name ilike p.lk or pl.area ilike p.lk
            or word_similarity(p.lq, lower(pl.name)) > p.thr)
      union all
      select 'vehicle', v.id, v.plate || coalesce(' · ' || v.model, ''), coalesce(v.color, ''), v.plate,
             greatest(word_similarity(p.lq, lower(v.plate)),
                      case when v.plate ilike p.lk or v.model ilike p.lk or v.color ilike p.lk or v.notes ilike p.lk then 0.95 else 0 end)
      from public.vehicles v, p
      where p.lq <> '' and (v.plate ilike p.lk or v.model ilike p.lk or v.color ilike p.lk or v.notes ilike p.lk
            or word_similarity(p.lq, lower(v.plate)) > p.thr)
      union all
      -- Accounts (spec D2): social handles surfaced for the cross-registry
      -- dup-check. SECURITY INVOKER — accounts pass through the caller's RLS
      -- (accounts_sel = is_active), so nothing leaks below an active member.
      select 'account', a.id, a.platform || ' · @' || a.handle, coalesce(a.display_name, ''), a.handle,
             greatest(word_similarity(p.lq, lower(a.handle)),
                      word_similarity(p.lq, lower(coalesce(a.display_name, ''))),
                      case when a.handle ilike p.lk or a.display_name ilike p.lk or a.external_id ilike p.lk then 0.95 else 0 end)
      from public.accounts a, p
      where p.lq <> '' and (a.handle ilike p.lk or a.display_name ilike p.lk or a.external_id ilike p.lk
            or word_similarity(p.lq, lower(a.handle)) > p.thr)
      union all
      -- Narcotics: merged tombstones excluded; aliases (street/server names)
      -- searched alongside name/classification. SECURITY INVOKER: both tables
      -- pass through the caller's RLS, so restricted rows (and their aliases)
      -- fail closed for callers below senior_detective.
      select 'narcotic', n.id, n.name, coalesce(n.classification, ''), n.name,
             greatest(word_similarity(p.lq, lower(n.name)),
                      case when n.name ilike p.lk or n.classification ilike p.lk then 0.95 else 0 end,
                      case when exists (select 1 from public.narcotic_aliases a
                                         where a.narcotic_id = n.id
                                           and (a.alias ilike p.lk
                                                or word_similarity(p.lq, lower(a.alias)) > p.thr))
                           then 0.9 else 0 end)
      from public.narcotics n, p
      where p.lq <> '' and n.status <> 'merged'
        and (n.name ilike p.lk or n.classification ilike p.lk
            or word_similarity(p.lq, lower(n.name)) > p.thr
            or exists (select 1 from public.narcotic_aliases a
                        where a.narcotic_id = n.id
                          and (a.alias ilike p.lk
                               or word_similarity(p.lq, lower(a.alias)) > p.thr)))
      union all
      select 'bench', b.id, b.name, coalesce('Tier ' || b.tier, b.bench_type::text, 'bench'), null::text,
             greatest(word_similarity(p.lq, lower(coalesce(b.name, ''))),
                      case when b.name ilike p.lk then 0.95 else 0 end)
      from public.ballistics_benches b, p
      where p.lq <> '' and (b.name ilike p.lk or word_similarity(p.lq, lower(coalesce(b.name, ''))) > p.thr)
      union all
      select 'footprint', f.id, f.signature, coalesce(f.weapon, 'footprint'), null::text,
             greatest(word_similarity(p.lq, lower(coalesce(f.signature, ''))), word_similarity(p.lq, lower(coalesce(f.weapon, ''))),
                      case when f.signature ilike p.lk or f.weapon ilike p.lk then 0.95 else 0 end)
      from public.ballistic_footprints f, p
      where p.lq <> '' and (f.signature ilike p.lk or f.weapon ilike p.lk
            or word_similarity(p.lq, lower(coalesce(f.signature, ''))) > p.thr)
      union all
      select 'document', d.id, d.name, coalesce(d.folder, ''), null::text,
             greatest(word_similarity(p.lq, lower(coalesce(d.name, ''))),
                      case when d.name ilike p.lk then 0.95 else 0 end)
      from public.documents d, p
      where p.lq <> '' and (d.name ilike p.lk or word_similarity(p.lq, lower(coalesce(d.name, ''))) > p.thr)
      union all
      -- Legal requests (v1.14): SECURITY INVOKER means the caller's RLS
      -- filters every row here — unauthorized users get nothing, sealed
      -- requests stay invisible. Header fields only, never narratives.
      select 'legal', lr.id,
             lr.request_number || ' · ' || lr.title,
             initcap(lr.request_type) || ' · ' || replace(lr.review_status, '_', ' '),
             null::text,
             greatest(word_similarity(p.lq, lower(lr.title)),
                      word_similarity(p.lq, lower(lr.request_number)),
                      case when lr.request_number ilike p.lk or lr.title ilike p.lk
                                or lr.person_name_snapshot ilike p.lk or lr.recipient_name ilike p.lk
                                or lr.case_number_snapshot ilike p.lk then 0.95 else 0 end)
      from public.legal_requests lr, p
      where p.lq <> '' and (lr.request_number ilike p.lk or lr.title ilike p.lk
            or lr.person_name_snapshot ilike p.lk or lr.recipient_name ilike p.lk
            or lr.case_number_snapshot ilike p.lk
            or word_similarity(p.lq, lower(lr.request_number || ' ' || lr.title)) > p.thr)
      union all
      -- Reports live inside a case → id is the CASE id (client opens the case
      -- Reports tab). Bodies searched by jsonb *values* only, never keys/UUIDs.
      select 'report', r.case_id,
             coalesce(nullif(r.template, ''), 'Report') || ' · ' || c.case_number,
             'Report in ' || coalesce(nullif(c.title, ''), c.case_number),
             null::text,
             greatest(word_similarity(p.lq, lower(coalesce(r.template, ''))),
                      case when r.template ilike p.lk
                                or exists (select 1 from jsonb_each_text(r.fields) kv where kv.value ilike p.lk) then 0.9 else 0 end)
      from public.reports r join public.cases c on c.id = r.case_id, p
      where p.lq <> '' and (r.template ilike p.lk
            or exists (select 1 from jsonb_each_text(r.fields) kv where kv.value ilike p.lk))
      union all
      -- Evidence also lives inside a case → id is the CASE id (Evidence tab).
      select 'evidence', e.case_id,
             coalesce(nullif(e.item_code, ''), 'Evidence') || coalesce(' · ' || e.type, ''),
             left(coalesce(e.description, ''), 90),
             e.item_code,
             greatest(word_similarity(p.lq, lower(coalesce(e.item_code, ''))),
                      word_similarity(p.lq, lower(coalesce(e.description, ''))),
                      case when e.item_code ilike p.lk or e.description ilike p.lk or e.type ilike p.lk
                                or e.location ilike p.lk or e.notes ilike p.lk then 0.92 else 0 end)
      from public.evidence e join public.cases c on c.id = e.case_id, p
      where p.lq <> '' and (e.item_code ilike p.lk or e.description ilike p.lk or e.type ilike p.lk
            or e.location ilike p.lk or e.notes ilike p.lk
            or word_similarity(p.lq, lower(coalesce(e.item_code, '') || ' ' || coalesce(e.description, ''))) > p.thr)
      union all
      select 'operation', o.id, o.name, coalesce(initcap(o.status), 'Operation'), o.name,
             greatest(word_similarity(p.lq, lower(coalesce(o.name, ''))),
                      case when o.name ilike p.lk or o.description ilike p.lk then 0.95 else 0 end)
      from public.operations o, p
      where p.lq <> '' and (o.name ilike p.lk or o.description ilike p.lk
            or word_similarity(p.lq, lower(coalesce(o.name, ''))) > p.thr)
    ) u
  ) x
  where rn <= 8
  order by rank desc, label
  limit 60;
$function$;
revoke all on function public.search_all(text) from public;
revoke execute on function public.search_all(text) from anon;
grant execute on function public.search_all(text) to authenticated, service_role;

-- ============================================================================
-- Rollback (manual):
--   -- re-apply case_archive from 20260807130000 (drop the hold check);
--   -- re-apply media_del/reports_del/case_tasks_del from schema-snapshot
--   --   (drop the case_has_active_hold clause);
--   drop trigger if exists case_intel_links_block_change_under_hold on public.case_intel_links;
--   drop function if exists private.block_intel_link_change_under_hold();
--   -- re-apply search_all body from 20260807230000 (drop the 🔒 marker).
-- ============================================================================
