-- ─────────────────────────────────────────────────────────────────────────────
-- JTF legal routing — separate operational assignment from legal routing.
--
-- Problem: `cases.bureau = 'JTF'` is an OPERATIONAL designation (visible to
-- every active member; a first-class case-number block), but the legal
-- workflow requires a permanent responsible bureau (LSB/BCB/SAB) for routing.
-- `private.legal_resolve_bureau` only consulted cases.bureau and
-- cases.originating_bureau, so every JTF case with a null (or 'JTF'-poisoned)
-- originating_bureau failed AT DRAFT CREATION with "this case has no
-- responsible bureau …" — and the one repair RPC
-- (resolve_case_originating_bureau) had no UI call site and refused to correct
-- an already-set value. convert_case_to_joint made it worse by writing
-- originating_bureau = bureau ('JTF') for JTF cases.
--
-- The model after this migration:
--   · cases.bureau            — operational assignment (may be 'JTF')
--   · cases.originating_bureau — the RESPONSIBLE bureau for legal routing
--     (always LSB/BCB/SAB or null; 'JTF' is now unstorable via CHECK)
--   · legal_requests.responsible_bureau — stamped from the chain below,
--     unchanged CHECK (LSB/BCB/SAB only)
--
-- Resolution chain (private.legal_resolve_bureau, all legal paths ride it —
-- create_legal_request, submit_legal_request_to_cid, import_legal_warrant):
--   1. cases.bureau when permanent (unchanged)
--   2. cases.originating_bureau when permanent (unchanged)
--   3. NEW the bureau recorded in the case-number prefix (cases keep their
--      creation prefix, so 'SAB-9000034' moved into JTF still resolves SAB)
--   4. NEW the lead detective's division (when a permanent bureau)
--   5. NEW the case creator's division (when a permanent bureau)
--   A successful derivation is PERSISTED to cases.originating_bureau and
--   audited, so the case answers identically forever and the user is never
--   re-asked. If nothing resolves, the request is blocked with a clear
--   message; an authorized supervisor sets the bureau via the (now reachable
--   and UI-wired) resolve_case_originating_bureau RPC.
--
-- Additive-only. No table/column drops, no data deletes. The backfill is
-- idempotent (scoped to null/'JTF' values; never overwrites a valid bureau).
-- Sealed-request visibility, case RLS, and the freeze trigger
-- (block_direct_case_bureau) are untouched — originating_bureau writes still
-- flow ONLY through definer RPCs.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. legal_resolve_bureau: extended chain + persist-on-derive ─────────────
-- VOLATILE now (was stable): a successful derivation writes the case row.
-- Only ever called from definer RPCs (create/submit/import) — never from a
-- policy or SELECT context, verified across all migrations.
create or replace function private.legal_resolve_bureau(p_case uuid)
returns public.bureau
language plpgsql security definer set search_path to '' as $$
declare c public.cases; v public.bureau; v_src text;
begin
  select * into c from public.cases where id = p_case;
  if not found then raise exception 'case not found'; end if;
  if c.bureau in ('LSB', 'BCB', 'SAB') then return c.bureau; end if;
  if c.originating_bureau in ('LSB', 'BCB', 'SAB') then return c.originating_bureau; end if;

  -- Derivation for JTF-assigned cases. Priority mirrors the recorded history:
  -- the case-number prefix is the bureau the number was minted under (numbers
  -- never change on reassignment), then the lead's bureau, then the creator's.
  if split_part(coalesce(c.case_number, ''), '-', 1) in ('LSB', 'BCB', 'SAB') then
    v := split_part(c.case_number, '-', 1)::public.bureau; v_src := 'case_number';
  end if;
  if v is null then
    select p.division into v from public.profiles p
     where p.id = c.lead_detective_id and p.division in ('LSB', 'BCB', 'SAB');
    if v is not null then v_src := 'lead_detective'; end if;
  end if;
  if v is null then
    select p.division into v from public.profiles p
     where p.id = c.created_by and p.division in ('LSB', 'BCB', 'SAB');
    if v is not null then v_src := 'creator'; end if;
  end if;
  if v is null then
    raise exception 'this case needs a responsible bureau for legal routing — a CID supervisor must select LSB, BCB, or SAB on the case';
  end if;

  -- Persist so the answer is stable and the user is never re-asked; audited
  -- like the manual set. Guarded on "still unset" so a concurrent manual set
  -- is never overwritten.
  update public.cases set originating_bureau = v
   where id = c.id and originating_bureau is null;
  if found then
    insert into public.audit_log (actor_id, action, entity, entity_id, detail)
    values ((select auth.uid()), 'ORIGINATING_BUREAU_SET', 'cases', c.id,
            jsonb_build_object('bureau', v, 'source', 'derived:' || v_src,
                               'via', 'legal_resolve_bureau'));
  end if;
  return v;
end $$;
revoke all on function private.legal_resolve_bureau(uuid) from public;

-- ── 2. Creation-time default: a JTF case is born with a responsible bureau ──
-- BEFORE INSERT: when a case is created with bureau='JTF' and no explicit
-- originating_bureau, default it from the creator's division (when permanent).
-- 'JTF' as an originating value is normalized away (the CHECK in §4 makes it
-- unstorable anyway). Applies to every insert path — CaseModal, templates,
-- imports — without changing any client. Non-JTF creations are untouched.
create or replace function private.default_case_originating_bureau()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.originating_bureau = 'JTF' then new.originating_bureau := null; end if;
  if new.bureau = 'JTF' and new.originating_bureau is null then
    select p.division into new.originating_bureau
      from public.profiles p
     where p.id = coalesce(new.created_by, (select auth.uid()))
       and p.division in ('LSB', 'BCB', 'SAB');
  end if;
  return new;
end $$;
drop trigger if exists trg_default_case_originating_bureau on public.cases;
create trigger trg_default_case_originating_bureau
  before insert on public.cases
  for each row execute function private.default_case_originating_bureau();

-- ── 3. Backfill existing cases (idempotent; never overwrites a valid value) ─
-- Scope: JTF cases with a missing responsible bureau, plus any case poisoned
-- with originating_bureau='JTF' (convert_case_to_joint pre-fix). Order:
-- recorded original bureau (case-number prefix) → current permanent bureau
-- (only reachable for poisoned non-JTF rows) → lead detective's bureau →
-- creator's bureau. Unresolvable rows are normalized to NULL — never guessed —
-- and remain flagged for a supervisor (the UI surfaces them; legal submission
-- stays blocked with the clear message until resolved).
with cand as (
  select c.id,
         coalesce(
           case when split_part(coalesce(c.case_number, ''), '-', 1) in ('LSB', 'BCB', 'SAB')
                then split_part(c.case_number, '-', 1)::public.bureau end,
           case when c.bureau in ('LSB', 'BCB', 'SAB') then c.bureau end,
           (select p.division from public.profiles p
             where p.id = c.lead_detective_id and p.division in ('LSB', 'BCB', 'SAB')),
           (select p.division from public.profiles p
             where p.id = c.created_by and p.division in ('LSB', 'BCB', 'SAB'))
         ) as nb,
         case
           when split_part(coalesce(c.case_number, ''), '-', 1) in ('LSB', 'BCB', 'SAB') then 'case_number'
           when c.bureau in ('LSB', 'BCB', 'SAB') then 'bureau'
           when exists (select 1 from public.profiles p
                         where p.id = c.lead_detective_id and p.division in ('LSB', 'BCB', 'SAB')) then 'lead_detective'
           when exists (select 1 from public.profiles p
                         where p.id = c.created_by and p.division in ('LSB', 'BCB', 'SAB')) then 'creator'
         end as src
    from public.cases c
   where c.originating_bureau = 'JTF'
      or (c.bureau = 'JTF' and c.originating_bureau is null)
), repaired as (
  update public.cases c
     set originating_bureau = cand.nb
    from cand
   where c.id = cand.id and cand.nb is not null
  returning c.id, cand.nb, cand.src
)
insert into public.audit_log (actor_id, action, entity, entity_id, detail)
select null, 'ORIGINATING_BUREAU_BACKFILL', 'cases', r.id,
       jsonb_build_object('bureau', r.nb, 'source', 'derived:' || r.src,
                          'via', 'migration:20260815120000')
  from repaired r;

-- Unresolvable poisoned rows: normalize 'JTF' → NULL (flagged, never guessed).
update public.cases set originating_bureau = null where originating_bureau = 'JTF';

-- ── 4. Make 'JTF' unstorable as a responsible bureau ────────────────────────
alter table public.cases drop constraint if exists cases_originating_bureau_permanent;
alter table public.cases add constraint cases_originating_bureau_permanent
  check (originating_bureau is null or originating_bureau in ('LSB', 'BCB', 'SAB'));

-- ── 5. convert_case_to_joint: stop poisoning JTF cases ──────────────────────
-- Verbatim re-emit of the 20260713040000 body EXCEPT the originating_bureau
-- backfill, which now only records a PERMANENT bureau (a JTF case keeps its
-- existing responsible bureau, or stays null for the supervisor to set).
create or replace function public.convert_case_to_joint(p_case uuid, p_members jsonb, p_note text default null)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare v_uid uuid := (select auth.uid()); c public.cases; v_n int;
begin
  if not private.can_manage_joint(p_case) then raise exception 'not permitted to manage this case'; end if;
  select * into c from public.cases where id = p_case for update;
  if not found then raise exception 'case not found'; end if;
  if c.is_joint_case then raise exception 'case is already a joint case'; end if;
  update public.cases
     set is_joint_case = true,
         originating_bureau = coalesce(originating_bureau,
           case when bureau in ('LSB', 'BCB', 'SAB') then bureau end),
         joint_case_created_by = v_uid, joint_case_created_at = now(),
         joint_case_ended_by = null, joint_case_ended_at = null
   where id = p_case;
  v_n := private.joint_apply_members(p_case, p_members, v_uid);
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (v_uid, 'JOINT_CASE_CREATED', 'cases', p_case);
  return jsonb_build_object('case_id', p_case, 'members_added', v_n);
end $$;
revoke all on function public.convert_case_to_joint(uuid, jsonb, text) from public;
revoke execute on function public.convert_case_to_joint(uuid, jsonb, text) from anon;
grant execute on function public.convert_case_to_joint(uuid, jsonb, text) to authenticated, service_role;

-- ── 6. resolve_case_originating_bureau: set (supervisor) / change (DD+) ─────
-- Replaces the single-shot 2-arg version. Setting a missing responsible
-- bureau stays at the Senior Detective+ bar (unchanged); CHANGING an
-- already-valid value is an org correction — Deputy Director+ / Owner with a
-- required reason (case_reassign_bureau parity). Both are audited. A case
-- whose own bureau is permanent is refused (its responsible bureau IS its
-- bureau — case_reassign_bureau is the path to move it). Old 2-arg client
-- calls keep working through the p_reason default.
drop function if exists public.resolve_case_originating_bureau(uuid, public.bureau);
create or replace function public.resolve_case_originating_bureau(
  p_case uuid, p_bureau public.bureau, p_reason text default null)
returns public.cases
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); c public.cases; me public.profiles;
        v_old public.bureau; v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into me from public.profiles where id = v_uid;
  if me.id is null or not coalesce(me.active, false)
     or not (me.role in ('senior_detective', 'bureau_lead', 'deputy_director', 'director')
             or coalesce(me.is_owner, false)) then
    raise exception 'only a CID supervisor may set the responsible bureau';
  end if;
  select * into c from public.cases where id = p_case for update;
  if not found or not private.can_access_case(p_case) then
    raise exception 'case not found or not accessible';
  end if;
  if p_bureau not in ('LSB', 'BCB', 'SAB') then
    raise exception 'the responsible bureau must be LSB, BCB, or SAB';
  end if;
  if c.bureau in ('LSB', 'BCB', 'SAB') then
    raise exception 'this case''s responsible bureau is its own bureau (%) — use the reassign-bureau workflow to move it', c.bureau;
  end if;
  v_old := c.originating_bureau;
  if v_old in ('LSB', 'BCB', 'SAB') then
    if v_old = p_bureau then
      raise exception 'the responsible bureau is already %', p_bureau;
    end if;
    if not (me.role in ('deputy_director', 'director') or coalesce(me.is_owner, false)) then
      raise exception 'the responsible bureau is already set to % — only a Deputy Director or higher may change it', v_old;
    end if;
    if v_reason = '' then
      raise exception 'a reason is required to change the responsible bureau';
    end if;
  end if;
  update public.cases set originating_bureau = p_bureau where id = p_case returning * into c;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid,
          case when v_old in ('LSB', 'BCB', 'SAB')
               then 'ORIGINATING_BUREAU_CHANGED' else 'ORIGINATING_BUREAU_SET' end,
          'cases', p_case,
          jsonb_build_object('bureau', p_bureau, 'previous', v_old, 'source', 'manual',
                             'reason', nullif(left(v_reason, 500), '')));
  return c;
end $$;
revoke all on function public.resolve_case_originating_bureau(uuid, public.bureau, text) from public;
revoke execute on function public.resolve_case_originating_bureau(uuid, public.bureau, text) from anon;
grant execute on function public.resolve_case_originating_bureau(uuid, public.bureau, text) to authenticated, service_role;

-- ── 7. Route approval through the responsible bureau ────────────────────────
-- can_approve_legal previously let ANY bureau lead approve any request their
-- case access reached — on a JTF case (visible to everyone) that meant every
-- lead. A bureau lead may now approve only requests routed to THEIR bureau
-- (r.responsible_bureau); Deputy Director / Director keep the cross-bureau
-- authority they already had. Same role set as private.is_command — this
-- narrows the lead branch, never widens anything. Self-approval stays blocked.
create or replace function private.can_approve_legal(p_request uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1
      from public.legal_requests r
      join public.profiles me on me.id = p_user
     where r.id = p_request
       and r.created_by <> p_user
       and p_user = (select auth.uid())
       and private.is_active()
       and private.can_access_case(r.case_id)
       and (me.role in ('deputy_director', 'director')
            or (me.role = 'bureau_lead' and me.division = r.responsible_bureau)))
$$;
revoke all on function private.can_approve_legal(uuid, uuid) from public;

-- Rollback: drop trigger trg_default_case_originating_bureau on public.cases;
--           drop function private.default_case_originating_bureau();
--           alter table public.cases drop constraint cases_originating_bureau_permanent;
--           re-emit the 20260714040000 legal_resolve_bureau, 20260713040000
--           convert_case_to_joint, 20260714045000 resolve_case_originating_bureau
--           (2-arg), and 20260808140000 can_approve_legal bodies.
-- Backfilled originating_bureau values and audit rows remain, by design.
