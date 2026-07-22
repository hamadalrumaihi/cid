-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 4a hardening — two correctness fixes flagged in the security review of
-- 20260808220000. Additive/idempotent; no data changes.
--
--  M1  search_all's account-lifecycle guard was added by re-emitting the body
--      from the STALE 20260807230000 version, which silently reverted the
--      '🔒 Legal hold · ' case-branch marker that 20260808160000 (preservation
--      lock) had added. This re-emits search_all with BOTH the hold marker
--      (restored) and the account merged-tombstone guard (kept).
--
--  M2  account_merge adopts a victim's external_id onto a null-external_id
--      survivor, but the victim still held that id at that moment, colliding
--      with the partial unique index accounts_platform_extid_uidx
--      (platform, external_id) — so a same-platform duplicate merge (the common
--      case) aborted on a unique violation. Fix is twofold: (a) the unique index
--      now excludes merged tombstones, and (b) account_merge tombstones the
--      victim BEFORE adopting its external_id, so only the survivor is an active
--      holder of (platform, external_id) at adoption time.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── M2a. The platform-identity uniqueness ignores merged tombstones ──────────
drop index if exists public.accounts_platform_extid_uidx;
create unique index accounts_platform_extid_uidx
  on public.accounts (platform, external_id)
  where external_id is not null and lifecycle <> 'merged';

-- ── M2b. account_merge: tombstone the victim before adopting its external_id ──
-- Body identical to 20260808220000 EXCEPT the per-victim mutation order — the
-- lifecycle='merged' tombstone now runs before the scalar/external_id fold, so
-- the victim has already left accounts_platform_extid_uidx when the survivor
-- adopts its platform id. All other semantics (gate, FOR UPDATE, repoints, hold
-- chokepoint, audit) are unchanged.
create or replace function public.account_merge(p_survivor uuid, p_victims uuid[], p_reason text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_reason text := btrim(coalesce(p_reason, ''));
  s public.accounts;
  v public.accounts;
  v_victim uuid;
  n_links int; n_handles int; n_cil int;
begin
  if not (private.is_command() or private.can_delete()) then
    raise exception 'account merge is restricted to command (Bureau Lead or higher)';
  end if;
  if v_reason = '' then
    raise exception 'a reason is required to merge account records';
  end if;
  if p_victims is null or cardinality(p_victims) = 0 then
    raise exception 'at least one merge victim is required';
  end if;
  if p_survivor = any (p_victims) then
    raise exception 'the survivor cannot also be a merge victim';
  end if;

  select * into s from public.accounts where id = p_survivor for update;
  if s.id is null then raise exception 'survivor account not found'; end if;
  if s.lifecycle = 'merged' then
    raise exception 'the survivor is already merged into another record — merge into its survivor instead';
  end if;

  foreach v_victim in array p_victims loop
    select * into v from public.accounts where id = v_victim for update;
    if v.id is null then raise exception 'merge victim % not found', v_victim; end if;
    if v.lifecycle = 'merged' then
      raise exception 'account % is already merged and cannot be merged again', v_victim;
    end if;
  end loop;

  foreach v_victim in array p_victims loop
    select * into v from public.accounts where id = v_victim;

    delete from public.account_links l
     where l.account_id = v_victim
       and exists (select 1 from public.account_links d
                    where d.account_id = p_survivor
                      and d.subject_kind = l.subject_kind
                      and d.subject_id = l.subject_id);
    update public.account_links set account_id = p_survivor where account_id = v_victim;
    get diagnostics n_links = row_count;

    insert into public.account_handles (account_id, handle, is_current, observed_at, source)
    select p_survivor, h.handle, false, h.observed_at, coalesce(h.source, 'merged')
      from public.account_handles h where h.account_id = v_victim;
    get diagnostics n_handles = row_count;

    delete from public.case_intel_links l
     where l.kind = 'account' and l.ref_id = v_victim
       and exists (select 1 from public.case_intel_links d
                    where d.case_id = l.case_id and d.kind = 'account' and d.ref_id = p_survivor);
    update public.case_intel_links set ref_id = p_survivor
     where kind = 'account' and ref_id = v_victim;
    get diagnostics n_cil = row_count;

    -- Tombstone the victim FIRST (kept, never deleted) so it leaves the
    -- (platform, external_id) partial unique index before the survivor adopts
    -- its platform id below.
    update public.accounts
       set lifecycle = 'merged', merged_into = p_survivor
     where id = v_victim;

    -- Conservative scalar merge: the survivor keeps its own values.
    if (s.display_name is null or btrim(s.display_name) = '')
       and v.display_name is not null and btrim(v.display_name) <> '' then
      update public.accounts set display_name = v.display_name where id = p_survivor;
      s.display_name := v.display_name;
    end if;
    if (s.summary is null or btrim(s.summary) = '')
       and v.summary is not null and btrim(v.summary) <> '' then
      update public.accounts set summary = v.summary where id = p_survivor;
      s.summary := v.summary;
    end if;
    if (v.operator_unknown and not s.operator_unknown)
       or (v.is_impersonation and not s.is_impersonation)
       or (v.is_compromised and not s.is_compromised) then
      update public.accounts
         set operator_unknown = s.operator_unknown or v.operator_unknown,
             is_impersonation = s.is_impersonation or v.is_impersonation,
             is_compromised = s.is_compromised or v.is_compromised
       where id = p_survivor;
      s.operator_unknown := s.operator_unknown or v.operator_unknown;
      s.is_impersonation := s.is_impersonation or v.is_impersonation;
      s.is_compromised := s.is_compromised or v.is_compromised;
    end if;
    -- Adopt the victim's platform id only if the survivor lacks one. The victim
    -- is already a merged tombstone (above), so it no longer occupies the
    -- (platform, external_id) partial unique index — no collision.
    if s.external_id is null and v.external_id is not null then
      update public.accounts set external_id = v.external_id where id = p_survivor;
      s.external_id := v.external_id;
    end if;

    insert into public.audit_log (actor_id, action, entity, entity_id, detail)
    values (v_uid, 'ACCOUNT_MERGED', 'accounts', v_victim, jsonb_build_object(
      'survivor_id', p_survivor, 'victim_id', v_victim,
      'victim_platform', v.platform, 'victim_handle', v.handle,
      'reason', left(v_reason, 500),
      'repointed', jsonb_build_object(
        'account_links', n_links, 'account_handles', n_handles,
        'case_intel_links', n_cil)));
  end loop;
end $function$;

revoke all on function public.account_merge(uuid, uuid[], text) from public, anon;
grant execute on function public.account_merge(uuid, uuid[], text) to authenticated, service_role;

-- ── M1. search_all: restore the legal-hold marker AND keep the account guard ──
-- Re-emitted from 20260808160000 (the definition that added the case-branch
-- '🔒 Legal hold · ' marker) with ONLY the account branch's
-- `a.lifecycle is distinct from 'merged'` guard added.
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
      select 'account', a.id, a.platform || ' · @' || a.handle, coalesce(a.display_name, ''), a.handle,
             greatest(word_similarity(p.lq, lower(a.handle)),
                      word_similarity(p.lq, lower(coalesce(a.display_name, ''))),
                      case when a.handle ilike p.lk or a.display_name ilike p.lk or a.external_id ilike p.lk then 0.95 else 0 end)
      from public.accounts a, p
      where a.lifecycle is distinct from 'merged'
        and p.lq <> '' and (a.handle ilike p.lk or a.display_name ilike p.lk or a.external_id ilike p.lk
            or word_similarity(p.lq, lower(a.handle)) > p.thr)
      union all
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
