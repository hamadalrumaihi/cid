-- ─────────────────────────────────────────────────────────────────────────────
-- Warrant execution: typed outcome + structured seized-items inventory (spec D3).
--
-- Batch-10 decisions:
--   • execution supports a typed result — full / partial / unable — with a
--     reason required when the warrant could not be executed (10.3);
--   • seized property is recorded BOTH as free text (the existing
--     execution_notes) AND as structured inventory rows that can link to
--     evidence / persons / vehicles (10.6).
--
-- "unable" is NOT an execution: the warrant stays 'issued' (it can be retried,
-- left to expire, or revoked) and only records the failed attempt + reason.
-- full / partial advance to 'executed' exactly as before. Additive: a new
-- nullable column, a new table (RLS: read follows the request wall, writes go
-- through can_fulfil_legal RPCs only), and a signature bump to
-- record_warrant_execution (drop+recreate — named-arg callers are unaffected).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.legal_requests add column if not exists execution_result text;
alter table public.legal_requests drop constraint if exists legal_requests_execution_result_check;
alter table public.legal_requests add constraint legal_requests_execution_result_check
  check (execution_result is null or execution_result in ('full', 'partial', 'unable'));

-- ── Typed execution recording ────────────────────────────────────────────────
drop function if exists public.record_warrant_execution(uuid, text, text, timestamptz);
create or replace function public.record_warrant_execution(
  p_request uuid, p_outcome text, p_notes text default null,
  p_result text default 'full', p_executed_at timestamptz default now())
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.request_type <> 'warrant' then raise exception 'not a warrant'; end if;
  if r.fulfilment_status <> 'issued' then raise exception 'only an issued warrant can be executed'; end if;
  if not private.can_fulfil_legal(p_request, v_uid) then
    raise exception 'only an authorized CID member on this case may record execution';
  end if;
  if coalesce(p_result, 'full') not in ('full', 'partial', 'unable') then
    raise exception 'invalid execution result';
  end if;
  if r.expires_at is not null and r.expires_at < now() then
    raise exception 'this warrant has expired — record expiry via close';
  end if;
  -- "unable" requires a reason and does NOT execute the warrant: it stays issued.
  if p_result = 'unable' then
    if btrim(coalesce(p_outcome, '')) = '' then
      raise exception 'a reason is required when a warrant could not be executed';
    end if;
    update public.legal_requests
       set execution_result = 'unable',
           execution_outcome = btrim(p_outcome),
           execution_notes = nullif(btrim(coalesce(p_notes, '')), '')
     where id = p_request returning * into r;
    perform private.legal_log(p_request, r.current_version_id, 'execution_attempt', 'issued', 'issued', p_outcome, null);
    perform private.legal_audit(p_request, 'LEGAL_EXECUTION_UNABLE', jsonb_build_object('reason', btrim(p_outcome)));
    perform private.legal_notify(r.assigned_ada_id, p_request, 'legal_update', 'A warrant could not be executed.');
    return r;
  end if;
  update public.legal_requests
     set fulfilment_status = 'executed', executed_by = v_uid,
         executed_at = coalesce(p_executed_at, now()),
         execution_result = p_result,
         execution_outcome = nullif(btrim(coalesce(p_outcome, '')), ''),
         execution_notes = nullif(btrim(coalesce(p_notes, '')), '')
   where id = p_request returning * into r;
  perform private.legal_log(p_request, r.current_version_id, 'executed', 'issued', 'executed', p_outcome, null);
  perform private.legal_audit(p_request, 'LEGAL_EXECUTED', jsonb_build_object('outcome', p_outcome, 'result', p_result));
  perform private.mdt_project(p_request, 'executed');
  perform private.legal_notify(r.assigned_ada_id, p_request, 'legal_update', 'A warrant was executed.');
  perform private.legal_notify(r.assigned_judge_id, p_request, 'legal_update', 'A warrant you approved was executed.');
  return r;
end $$;
revoke all on function public.record_warrant_execution(uuid, text, text, text, timestamptz) from public;
revoke execute on function public.record_warrant_execution(uuid, text, text, text, timestamptz) from anon;
grant execute on function public.record_warrant_execution(uuid, text, text, text, timestamptz) to authenticated, service_role;

-- ── Structured seized-items inventory ────────────────────────────────────────
create table if not exists public.legal_seized_items (
  id uuid primary key default gen_random_uuid(),
  legal_request_id uuid not null references public.legal_requests(id) on delete cascade,
  item text not null,
  quantity text,
  category text,
  evidence_id uuid references public.evidence(id) on delete set null,
  person_id uuid references public.persons(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  notes text,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint legal_seized_items_category_check check (
    category is null or category in
      ('weapon', 'narcotics', 'currency', 'electronics', 'document', 'vehicle', 'other'))
);
create index if not exists legal_seized_items_request_idx on public.legal_seized_items (legal_request_id);

alter table public.legal_seized_items enable row level security;

-- Read follows the request wall (same as exhibits). Writes are RPC-only:
-- no INSERT/UPDATE/DELETE policy → direct client writes are denied.
drop policy if exists lsi_sel on public.legal_seized_items;
create policy lsi_sel on public.legal_seized_items for select to authenticated
using (private.can_view_legal_request(legal_request_id, (select auth.uid())));

create or replace function public.legal_seized_item_add(
  p_request uuid, p_item text, p_quantity text default null, p_category text default null,
  p_evidence uuid default null, p_person uuid default null, p_vehicle uuid default null,
  p_notes text default null)
returns public.legal_seized_items
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); s public.legal_seized_items; r public.legal_requests;
begin
  select * into r from public.legal_requests where id = p_request;
  if not found then raise exception 'request not found'; end if;
  if r.request_type <> 'warrant' then raise exception 'seized items belong to a warrant'; end if;
  if not private.can_fulfil_legal(p_request, v_uid) then
    raise exception 'only an authorized CID member on this case may log seized items';
  end if;
  if btrim(coalesce(p_item, '')) = '' then raise exception 'an item description is required'; end if;
  if p_category is not null and p_category not in
     ('weapon', 'narcotics', 'currency', 'electronics', 'document', 'vehicle', 'other') then
    raise exception 'invalid category';
  end if;
  insert into public.legal_seized_items
    (legal_request_id, item, quantity, category, evidence_id, person_id, vehicle_id, notes, added_by)
  values (p_request, btrim(p_item), nullif(btrim(coalesce(p_quantity, '')), ''), p_category,
          p_evidence, p_person, p_vehicle, nullif(btrim(coalesce(p_notes, '')), ''), v_uid)
  returning * into s;
  perform private.legal_audit(p_request, 'LEGAL_SEIZED_ITEM_ADDED',
    jsonb_build_object('item', btrim(p_item), 'category', p_category, 'quantity', nullif(btrim(coalesce(p_quantity, '')), '')));
  return s;
end $$;
revoke all on function public.legal_seized_item_add(uuid, text, text, text, uuid, uuid, uuid, text) from public;
revoke execute on function public.legal_seized_item_add(uuid, text, text, text, uuid, uuid, uuid, text) from anon;
grant execute on function public.legal_seized_item_add(uuid, text, text, text, uuid, uuid, uuid, text) to authenticated, service_role;

create or replace function public.legal_seized_item_remove(p_item uuid)
returns void
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); s public.legal_seized_items;
begin
  select * into s from public.legal_seized_items where id = p_item;
  if not found then raise exception 'seized item not found'; end if;
  if not private.can_fulfil_legal(s.legal_request_id, v_uid) then
    raise exception 'only an authorized CID member on this case may remove seized items';
  end if;
  delete from public.legal_seized_items where id = p_item;
  perform private.legal_audit(s.legal_request_id, 'LEGAL_SEIZED_ITEM_REMOVED',
    jsonb_build_object('item', s.item));
end $$;
revoke all on function public.legal_seized_item_remove(uuid) from public;
revoke execute on function public.legal_seized_item_remove(uuid) from anon;
grant execute on function public.legal_seized_item_remove(uuid) to authenticated, service_role;
