-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 4b — returned-record extraction.
--
-- The workflow where an investigator receives a records return (a subpoena/
-- warrant return from a platform or telco, or a manually-typed structured
-- entry) and captures its FACTS into a case. Two capture modes only —
-- manual structured entry and importing a known city format. NO runtime AI.
--
-- Guardrails baked into the schema + the ingest RPC (never the UI):
--   • retain source location PER FACT (record_extraction_facts.source_location
--     is NOT NULL + non-blank) — provenance for every captured identifier;
--   • route contact/account identifiers through the Indicators registry
--     (cross-case deconfliction) — the RPC inserts the public.indicators row;
--   • auto-link, NEVER auto-confirm — an ownership assertion find-or-creates an
--     account_links row at ownership_confidence='suspected' only. Confirming is
--     a command action (Phase 4a account_link_guard_confirm, Lead+), and that
--     guard evaluates the REAL caller even from inside this SECURITY DEFINER
--     RPC (private.is_command() reads auth.uid()), so 'confirmed' is
--     unreachable via this path — defense in depth on top of the hard-coded
--     'suspected'.
--
-- Additive only: one CHECK widen (indicators.kind gains 'email'), two new
-- tables, one SECURITY DEFINER RPC. No table/column drops, no data deletes.
-- Definitive SQL lives here; the snapshot mirrors table DDL / constraints /
-- policies as real SQL and the function as tail commentary.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. indicators.kind admits 'email' ───────────────────────────────────────
-- Contact identifiers include email, which had no kind. One-line drop+add,
-- exactly the pattern narcotics/accounts used for their kind CHECKs.
alter table public.indicators drop constraint indicators_kind_check;
alter table public.indicators add constraint indicators_kind_check
  check (kind = any (array['phone'::text, 'account'::text, 'serial'::text,
                           'alias'::text, 'address'::text, 'email'::text, 'other'::text]));

-- ── 2. record_extractions — one row per ingested records-return document ─────
-- A case child (case_id → cases ON DELETE CASCADE): when the case is deleted the
-- extraction and its facts cascade away, so rls_test_cleanup's existing case
-- purge sweeps them with no cleanup change needed.
create table if not exists public.record_extractions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  source_label text not null,
  -- The two capture modes (manual structured entry / known city-format import).
  source_kind text,
  -- Optional external/document pointer (a FiveManage URL, a return id, etc.).
  source_ref text,
  notes text,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint record_extractions_source_label_check check (length(btrim(source_label)) > 0),
  constraint record_extractions_source_kind_check
    check (source_kind is null or source_kind in ('manual', 'city_import'))
);
create index if not exists record_extractions_case_idx on public.record_extractions (case_id);
create index if not exists record_extractions_created_by_idx on public.record_extractions (created_by);
alter table public.record_extractions enable row level security;

-- ── 3. record_extraction_facts — one row per extracted fact ──────────────────
-- Writes are RPC-ONLY (public.extraction_add_fact, SECURITY DEFINER): there is
-- NO client write policy, so the source-location / indicator-routing / auto-link
-- guardrails cannot be bypassed by a direct insert. Reads follow the parent
-- extraction's case access. source_location is NOT NULL + non-blank — the
-- "retain source location per fact" guardrail at the schema level.
create table if not exists public.record_extraction_facts (
  id uuid primary key default gen_random_uuid(),
  extraction_id uuid not null references public.record_extractions(id) on delete cascade,
  fact_type text not null,
  value text not null,
  source_location text not null,
  linked_indicator_id uuid references public.indicators(id) on delete set null,
  linked_account_id uuid references public.accounts(id) on delete set null,
  linked_link_id uuid references public.account_links(id) on delete set null,
  note text,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint record_extraction_facts_fact_type_check
    check (fact_type in ('account', 'phone', 'email', 'address', 'ownership', 'property', 'other')),
  constraint record_extraction_facts_value_check check (length(btrim(value)) > 0),
  constraint record_extraction_facts_source_location_check check (length(btrim(source_location)) > 0)
);
create index if not exists record_extraction_facts_extraction_idx on public.record_extraction_facts (extraction_id);
create index if not exists record_extraction_facts_indicator_idx on public.record_extraction_facts (linked_indicator_id) where linked_indicator_id is not null;
create index if not exists record_extraction_facts_account_idx on public.record_extraction_facts (linked_account_id) where linked_account_id is not null;
create index if not exists record_extraction_facts_link_idx on public.record_extraction_facts (linked_link_id) where linked_link_id is not null;
create index if not exists record_extraction_facts_created_by_idx on public.record_extraction_facts (created_by);
alter table public.record_extraction_facts enable row level security;

-- ── 4. RLS ───────────────────────────────────────────────────────────────────
-- record_extractions: sel/ins/upd gate on case access (mirrors reports); del is
-- command-only (private.can_delete(), mirroring indicators) — command staff are
-- cross-bureau by design, consistent with the rest of the case-child surface.
drop policy if exists record_extractions_sel on public.record_extractions;
drop policy if exists record_extractions_ins on public.record_extractions;
drop policy if exists record_extractions_upd on public.record_extractions;
drop policy if exists record_extractions_del on public.record_extractions;
create policy record_extractions_sel on public.record_extractions
  for select to authenticated using (private.can_access_case(case_id));
create policy record_extractions_ins on public.record_extractions
  for insert to authenticated with check (private.can_access_case(case_id));
create policy record_extractions_upd on public.record_extractions
  for update to authenticated using (private.can_access_case(case_id)) with check (private.can_access_case(case_id));
create policy record_extractions_del on public.record_extractions
  for delete to authenticated using (private.can_delete());

-- record_extraction_facts: SELECT-only for members, scoped to the parent
-- extraction's case access (mirrors report_versions_sel). No client write
-- policy — the definer RPC is the only writer; facts cascade-delete with their
-- extraction.
drop policy if exists record_extraction_facts_sel on public.record_extraction_facts;
create policy record_extraction_facts_sel on public.record_extraction_facts
  for select to authenticated using (exists (
    select 1 from public.record_extractions e
    where e.id = record_extraction_facts.extraction_id and private.can_access_case(e.case_id)));

-- ── 5. extraction_add_fact — the ingest RPC ──────────────────────────────────
-- Purpose:        capture one fact from a records return into an extraction —
--                 routing contact/account identifiers through the Indicators
--                 registry, find-or-creating the referenced account, and
--                 auto-linking any ownership assertion at 'suspected' (never
--                 'confirmed'). The one write path for record_extraction_facts.
-- Caller:         the returned-record extraction workspace (client, supabase.rpc).
-- Authorization:  private.can_access_case(extraction.case_id) — the member must
--                 be able to access the case the extraction belongs to.
-- Fan-out order:  (a) load + gate + validate value/source_location/fact_type;
--                 (b) route identifier → public.indicators (account/phone/
--                     email/address); (c) account find-or-create + suspected
--                     auto-link (account/ownership, when platform/owner given);
--                 (d) insert the fact row with the captured links; (e) audit.
-- Dedup:          accounts by (platform, lower(btrim(handle))) excluding merged
--                 tombstones; account_links by (account_id, 'person', owner).
-- Side effects:   may insert public.indicators / public.accounts /
--                 public.account_links; always inserts one
--                 public.record_extraction_facts + one audit_log row.
-- Security notes: SECURITY DEFINER, set search_path = '', schema-qualified,
--                 revoked from public/anon, granted to authenticated +
--                 service_role. ownership_confidence is HARD-CODED 'suspected';
--                 the Phase-4a account_link_guard_confirm still evaluates the
--                 real caller from here, so 'confirmed' is doubly unreachable.
create or replace function public.extraction_add_fact(
  p_extraction uuid,
  p_fact_type text,
  p_value text,
  p_source_location text,
  p_platform text default null,
  p_owner_person uuid default null,
  p_note text default null
)
returns public.record_extraction_facts
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_ext public.record_extractions;
  v_type text := btrim(coalesce(p_fact_type, ''));
  v_value text := btrim(coalesce(p_value, ''));
  v_loc text := btrim(coalesce(p_source_location, ''));
  v_platform text := nullif(btrim(coalesce(p_platform, '')), '');
  v_indicator_id uuid;
  v_account_id uuid;
  v_link_id uuid;
  v_fact public.record_extraction_facts;
begin
  select * into v_ext from public.record_extractions where id = p_extraction;
  if v_ext.id is null then
    raise exception 'record extraction not found';
  end if;
  if not private.can_access_case(v_ext.case_id) then
    raise exception 'you do not have access to this extraction''s case';
  end if;
  if v_value = '' then
    raise exception 'a non-blank value is required for every extracted fact';
  end if;
  if v_loc = '' then
    raise exception 'a source location is required for every extracted fact';
  end if;
  if v_type not in ('account', 'phone', 'email', 'address', 'ownership', 'property', 'other') then
    raise exception 'invalid fact_type: %', p_fact_type;
  end if;
  if p_owner_person is not null and not exists (select 1 from public.persons where id = p_owner_person) then
    raise exception 'owner person not found';
  end if;
  if v_type = 'ownership' and p_owner_person is null then
    raise exception 'an ownership fact requires an owner person';
  end if;
  if v_type = 'ownership' and v_platform is null then
    raise exception 'an ownership fact requires the account platform';
  end if;

  -- (b) Route contact/account identifiers through the Indicators registry —
  -- cross-case deconfliction. kind maps 1:1 to fact_type for these four.
  if v_type in ('account', 'phone', 'email', 'address') then
    insert into public.indicators (case_id, kind, value, note, created_by)
    values (v_ext.case_id, v_type, v_value,
            'From extraction “' || v_ext.source_label || '” @ ' || v_loc, v_uid)
    returning id into v_indicator_id;
  end if;

  -- (c) Account dedup + auto-link — for 'account' (when a platform is given) and
  -- 'ownership'. find-or-create the account by normalized handle, then, if an
  -- owner is asserted, find-or-create a SUSPECTED person ownership link.
  if v_type in ('account', 'ownership') and v_platform is not null then
    select id into v_account_id from public.accounts
      where platform = v_platform
        and handle_normalized = lower(btrim(v_value))
        and lifecycle <> 'merged'
      order by created_at
      limit 1;
    if v_account_id is null then
      insert into public.accounts (platform, handle, created_by)
      values (v_platform, v_value, v_uid)
      returning id into v_account_id;
    end if;

    if p_owner_person is not null then
      select id into v_link_id from public.account_links
        where account_id = v_account_id and subject_kind = 'person' and subject_id = p_owner_person;
      if v_link_id is null then
        insert into public.account_links
          (account_id, subject_kind, subject_id, person_id, ownership_confidence, source, created_by)
        values (v_account_id, 'person', p_owner_person, p_owner_person, 'suspected',
                'record extraction auto-link', v_uid)
        returning id into v_link_id;
      end if;
    end if;
  end if;

  -- (d) Insert the fact with every captured link + its source location.
  insert into public.record_extraction_facts
    (extraction_id, fact_type, value, source_location,
     linked_indicator_id, linked_account_id, linked_link_id, note, created_by)
  values (p_extraction, v_type, v_value, v_loc,
          v_indicator_id, v_account_id, v_link_id, nullif(btrim(coalesce(p_note, '')), ''), v_uid)
  returning * into v_fact;

  -- (e) Audit.
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'EXTRACTION_FACT_ADDED', 'record_extraction_facts', v_fact.id, jsonb_build_object(
    'extraction_id', p_extraction, 'case_id', v_ext.case_id, 'fact_type', v_type,
    'source_location', left(v_loc, 200),
    'indicator_id', v_indicator_id, 'account_id', v_account_id, 'link_id', v_link_id,
    'owner_person', p_owner_person, 'auto_link_confidence',
      case when v_link_id is not null then 'suspected' else null end));

  return v_fact;
end $function$;

revoke all on function public.extraction_add_fact(uuid, text, text, text, text, uuid, text) from public, anon;
grant execute on function public.extraction_add_fact(uuid, text, text, text, text, uuid, text) to authenticated, service_role;

-- ============================================================================
-- Rollback (manual):
--   drop function if exists public.extraction_add_fact(uuid, text, text, text, text, uuid, text);
--   drop table if exists public.record_extraction_facts;
--   drop table if exists public.record_extractions;
--   alter table public.indicators drop constraint indicators_kind_check;
--   alter table public.indicators add constraint indicators_kind_check
--     check (kind = any (array['phone'::text,'account'::text,'serial'::text,
--                              'alias'::text,'address'::text,'other'::text]));
-- (audit_log rows already written are retained by design.)
-- ============================================================================
