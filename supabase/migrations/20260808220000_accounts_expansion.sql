-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 4a — accounts expansion.
--
-- The Accounts registry (20260807220000) landed handle/identity plumbing but no
-- taxonomy, lifecycle, or merge story, and its ownership links were person-only.
-- This expansion is additive-only:
--   • accounts learns a category, a platform-account state, three independent
--     descriptor flags (unknown-operator / impersonation / compromised), a merge
--     tombstone (lifecycle + merged_into), and a normalized profile URL; the
--     immutable platform id (external_id) is now frozen once set by a trigger.
--   • account_links becomes POLYMORPHIC (subject_kind + subject_id) while keeping
--     person_id as a denormalized mirror for person-kind links so existing person
--     flows keep working; a Lead+ confirm gate blocks non-command members from
--     setting ownership_confidence='confirmed'.
--   • case_intel_links admits an 'account' kind (one-line CHECK extension, exactly
--     the pattern narcotics used).
--   • account_merge(uuid, uuid[], text) tombstones duplicate accounts with the
--     same delete-then-repoint + FOR UPDATE + audited-counts discipline as
--     person_merge / merge_narcotics; it repoints case_intel_links 'account' links
--     through the SAME hold chokepoint (a held linked case aborts the merge).
--   • search_all's account branch gains a merged-tombstone guard (mirrors the
--     persons/narcotics branches).
--
-- No table/column drops, no data deletes. New columns are nullable or defaulted
-- and backfilled. Definitive SQL lives here; the snapshot mirrors table DDL /
-- constraints / policies as real SQL and functions as tail commentary.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. accounts: taxonomy + state + descriptors + merge tombstone + norm URL ──
alter table public.accounts
  add column if not exists category text default 'person',
  add column if not exists state text default 'active',
  add column if not exists operator_unknown boolean not null default false,
  add column if not exists is_impersonation boolean not null default false,
  add column if not exists is_compromised boolean not null default false,
  add column if not exists lifecycle text not null default 'active',
  add column if not exists merged_into uuid,
  add column if not exists profile_url_normalized text
    generated always as (nullif(lower(btrim(profile_url)), '')) stored;

-- Backfill the two defaulted-but-nullable descriptors on any pre-existing rows.
update public.accounts set category = 'person' where category is null;
update public.accounts set state = 'active' where state is null;

alter table public.accounts
  add constraint accounts_category_check
    check (category in ('person', 'shared', 'gang', 'business')),
  add constraint accounts_state_check
    check (state in ('active', 'suspended', 'deleted')),
  add constraint accounts_lifecycle_check
    check (lifecycle in ('active', 'merged')),
  add constraint accounts_merged_into_fkey
    foreign key (merged_into) references public.accounts(id) on delete set null;

create index if not exists accounts_lifecycle_idx on public.accounts (lifecycle);
create index if not exists accounts_merged_into_idx on public.accounts (merged_into) where merged_into is not null;

-- external_id is the immutable platform identity: a handle can change, this does
-- not. Freeze it once non-null. profile_url stays editable (corrections happen);
-- its normalized form is the generated column above, so no trigger normalization
-- is needed. Plain (invoker) trigger — nothing here needs elevated rights.
create or replace function private.account_freeze_identity()
returns trigger language plpgsql set search_path to '' as $$
begin
  if old.external_id is not null and new.external_id is distinct from old.external_id then
    raise exception 'account external_id is the immutable platform identity and cannot be changed once set';
  end if;
  return new;
end $$;
drop trigger if exists accounts_freeze_identity on public.accounts;
create trigger accounts_freeze_identity before update on public.accounts
  for each row execute function private.account_freeze_identity();

-- ── 2. account_links: polymorphic subject + Lead+ confirm gate ───────────────
alter table public.account_links
  add column if not exists subject_kind text,
  add column if not exists subject_id uuid;

-- Backfill: every existing link is a person link.
update public.account_links
   set subject_kind = 'person', subject_id = person_id
 where subject_kind is null;

-- person_id becomes a denormalized MIRROR (kept for person-kind links so the
-- existing PersonAccountsSection .eq(person_id) query and person flows work);
-- non-person links carry no person_id. subject_id is mandatory on every link.
alter table public.account_links alter column person_id drop not null;
alter table public.account_links alter column subject_id set not null;
-- subject_kind NOT NULL closes a CHECK-bypass: a NULL subject_kind would make
-- both the kind CHECK and the person-mirror CHECK evaluate to UNKNOWN (and pass).
-- Every backfilled/new link carries a kind, so this is additive-safe.
alter table public.account_links alter column subject_kind set not null;

alter table public.account_links
  add constraint account_links_subject_kind_check
    check (subject_kind in ('person', 'gang', 'business', 'case', 'vehicle', 'place')),
  -- The mirror invariant: person links (and only person links) carry person_id.
  add constraint account_links_person_mirror_check
    check ((subject_kind = 'person') = (person_id is not null)),
  -- One link per (account, subject). subject_id is NOT NULL so this is a plain
  -- unique (no null-distinct surprises); it subsumes the person case too
  -- (subject_kind='person', subject_id=person_id). The legacy UNIQUE(account_id,
  -- person_id) is intentionally KEPT — harmless under nulls-distinct (many
  -- non-person links share (account_id, NULL) as distinct) and still exact for
  -- person rows.
  add constraint account_links_subject_unique unique (account_id, subject_kind, subject_id);

create index if not exists account_links_subject_idx on public.account_links (subject_kind, subject_id);

-- Lead+ confirm gate. A non-command member may create/keep suspected/probable
-- links, but only command (Bureau Lead+) may first drive a link to 'confirmed'.
-- Plain (invoker) trigger mirroring block_intel_link_change_under_hold, so
-- private.is_command() evaluates against the REAL caller. Named to fire BEFORE
-- account_links_stamp (alphabetical: 'guard_confirm' < 'stamp'), so a rejected
-- confirm aborts before the stamp function runs.
create or replace function private.account_link_guard_confirm()
returns trigger language plpgsql set search_path to '' as $$
begin
  if new.ownership_confidence = 'confirmed'
     and (tg_op = 'INSERT' or old.ownership_confidence is distinct from 'confirmed')
     and not private.is_command() then
    raise exception 'confirming account ownership is a command action (Bureau Lead or higher)';
  end if;
  return new;
end $$;
drop trigger if exists account_links_guard_confirm on public.account_links;
create trigger account_links_guard_confirm before insert or update on public.account_links
  for each row execute function private.account_link_guard_confirm();

-- ── 3. case_intel_links: admit an 'account' kind ─────────────────────────────
alter table public.case_intel_links drop constraint case_intel_links_kind_check;
alter table public.case_intel_links add constraint case_intel_links_kind_check
  check (kind = any (array['person'::text, 'gang'::text, 'place'::text, 'narcotic'::text, 'account'::text]));

-- ── 4. account_merge: command-gated merge with tombstone semantics ───────────
-- Purpose:        merge duplicate account records: repoint every account_link
--                 and case_intel_links 'account' reference from each victim to
--                 the survivor (with UNIQUE-conflict care), copy the victim's
--                 handle history onto the survivor as non-current rows,
--                 conservatively fold victim scalars into the survivor, and turn
--                 each victim into a lifecycle='merged' tombstone pointing at the
--                 survivor. Victims are NEVER deleted.
-- Caller:         Accounts workspace merge dialog (client, supabase.rpc).
-- Authorization:  private.is_command() / private.can_delete() (Bureau Lead+);
--                 a non-blank reason is mandatory.
-- Side effects:   updates account_links / account_handles / case_intel_links
--                 rows; updates the survivor and victim accounts rows.
-- Audit behavior: one explicit ACCOUNT_MERGED audit_log row per victim (survivor
--                 id, victim id/handle, reason, per-table repoint counts).
-- Security notes: SECURITY DEFINER (must move rows across creators) with set
--                 search_path = '' and schema-qualified references;
--                 revoke-then-grant to authenticated. FOR UPDATE locks the
--                 survivor and every victim before any mutation. The
--                 case_intel_links repoint intentionally passes through the
--                 hold chokepoint (block_intel_link_change_under_hold): a held
--                 linked case aborts the whole merge — this is NOT bypassed.
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

  -- Lock and validate every victim before mutating anything.
  foreach v_victim in array p_victims loop
    select * into v from public.accounts where id = v_victim for update;
    if v.id is null then raise exception 'merge victim % not found', v_victim; end if;
    if v.lifecycle = 'merged' then
      raise exception 'account % is already merged and cannot be merged again', v_victim;
    end if;
  end loop;

  foreach v_victim in array p_victims loop
    select * into v from public.accounts where id = v_victim;

    -- account_links: UNIQUE(account_id, subject_kind, subject_id). Drop the
    -- victim's link where the survivor already links the same subject, repoint
    -- the rest. Only account_id moves — subject_kind/subject_id/person_id stay,
    -- so the person_id mirror invariant is preserved.
    delete from public.account_links l
     where l.account_id = v_victim
       and exists (select 1 from public.account_links d
                    where d.account_id = p_survivor
                      and d.subject_kind = l.subject_kind
                      and d.subject_id = l.subject_id);
    update public.account_links set account_id = p_survivor where account_id = v_victim;
    get diagnostics n_links = row_count;

    -- account_handles: copy the victim's trail onto the survivor as history
    -- (is_current=false — the one-current-per-account partial unique is untouched).
    insert into public.account_handles (account_id, handle, is_current, observed_at, source)
    select p_survivor, h.handle, false, h.observed_at, coalesce(h.source, 'merged')
      from public.account_handles h where h.account_id = v_victim;
    get diagnostics n_handles = row_count;

    -- case_intel_links: UNIQUE(case_id, kind, ref_id). Drop the victim link
    -- where the survivor is already linked to the same case, repoint the rest.
    -- This UPDATE fires block_intel_link_change_under_hold — a held linked case
    -- aborts the merge here (by design).
    delete from public.case_intel_links l
     where l.kind = 'account' and l.ref_id = v_victim
       and exists (select 1 from public.case_intel_links d
                    where d.case_id = l.case_id and d.kind = 'account' and d.ref_id = p_survivor);
    update public.case_intel_links set ref_id = p_survivor
     where kind = 'account' and ref_id = v_victim;
    get diagnostics n_cil = row_count;

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
    -- OR the three descriptors (independent; a positive on either side stands).
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
    -- Adopt the victim's immutable platform id only if the survivor lacks one
    -- (survivor external_id is null here, so accounts_freeze_identity allows it).
    if s.external_id is null and v.external_id is not null then
      update public.accounts set external_id = v.external_id where id = p_survivor;
      s.external_id := v.external_id;
    end if;

    -- Tombstone the victim (kept, never deleted).
    update public.accounts
       set lifecycle = 'merged', merged_into = p_survivor
     where id = v_victim;

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

-- ── 5. search_all: merged accounts leave search ──────────────────────────────
-- Body re-emitted verbatim from 20260807230000 (the current live definition)
-- with ONLY a lifecycle guard added to the 'account' branch, mirroring the
-- persons branch (pe.lifecycle is distinct from 'merged').
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
             left(coalesce(c.summary, ''), 90) as sublabel, null::text as term,
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
      -- Merged tombstones are excluded (Phase 4a), mirroring persons/narcotics.
      select 'account', a.id, a.platform || ' · @' || a.handle, coalesce(a.display_name, ''), a.handle,
             greatest(word_similarity(p.lq, lower(a.handle)),
                      word_similarity(p.lq, lower(coalesce(a.display_name, ''))),
                      case when a.handle ilike p.lk or a.display_name ilike p.lk or a.external_id ilike p.lk then 0.95 else 0 end)
      from public.accounts a, p
      where a.lifecycle is distinct from 'merged'
        and p.lq <> '' and (a.handle ilike p.lk or a.display_name ilike p.lk or a.external_id ilike p.lk
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
--   drop function if exists public.account_merge(uuid, uuid[], text);
--   -- search_all: re-apply the body from 20260807230000 to drop the account
--   -- lifecycle guard.
--   drop trigger if exists account_links_guard_confirm on public.account_links;
--   drop function if exists private.account_link_guard_confirm();
--   drop trigger if exists accounts_freeze_identity on public.accounts;
--   drop function if exists private.account_freeze_identity();
--   alter table public.case_intel_links drop constraint case_intel_links_kind_check;
--   alter table public.case_intel_links add constraint case_intel_links_kind_check
--     check (kind = any (array['person'::text,'gang'::text,'place'::text,'narcotic'::text]));
--   alter table public.account_links
--     drop constraint account_links_subject_unique,
--     drop constraint account_links_person_mirror_check,
--     drop constraint account_links_subject_kind_check;
--   drop index if exists public.account_links_subject_idx;
--   -- (person_id NOT NULL / subject_id nullability restore only if no polymorphic
--   --  rows exist; leave columns in place — additive by design.)
--   drop index if exists public.accounts_merged_into_idx;
--   drop index if exists public.accounts_lifecycle_idx;
--   alter table public.accounts
--     drop constraint accounts_merged_into_fkey,
--     drop constraint accounts_lifecycle_check,
--     drop constraint accounts_state_check,
--     drop constraint accounts_category_check;
--   alter table public.accounts
--     drop column if exists profile_url_normalized, drop column if exists merged_into,
--     drop column if exists lifecycle, drop column if exists is_compromised,
--     drop column if exists is_impersonation, drop column if exists operator_unknown,
--     drop column if exists state, drop column if exists category;
-- (audit_log rows already written are retained by design.)
-- ============================================================================
