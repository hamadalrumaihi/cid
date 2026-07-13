-- NULL-guard hardening, caught by the live RLS suite before release:
-- private.justice_role_of() returns NULL for users with no justice
-- membership, and `NULL in (...)` is NULL — so `if not <helper>()` in a
-- SECURITY DEFINER RPC silently SKIPPED the authorization raise for every
-- non-justice caller. A CID detective could pass can_manage_prosecutors(),
-- can_manage_legal_assignment(), can_review_as_da/_ag(),
-- can_review_justice_role(), admin_justice_membership_requests(),
-- legal_internal_notes(), and close_legal_request()'s revoke branch.
-- Every three-valued helper is now coalesced to a strict boolean.
-- (Policies were unaffected — RLS already treats NULL as deny — and the
-- EXISTS-based helpers were already two-valued.)

create or replace function private.can_manage_prosecutors()
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(private.justice_role() in ('district_attorney', 'attorney_general'), false)
      or coalesce((select is_owner and removed_at is null from public.profiles
                   where id = (select auth.uid())), false)
$$;

create or replace function private.can_review_justice_role(p_reviewer uuid, p_role text)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(case
    when coalesce((select is_owner and removed_at is null from public.profiles
                   where id = p_reviewer), false) then true
    when p_role = 'assistant_district_attorney'
      then private.justice_role_of(p_reviewer) in ('district_attorney', 'attorney_general')
    when p_role = 'district_attorney'
      then private.justice_role_of(p_reviewer) = 'attorney_general'
    else false  -- attorney_general and judge require Owner
  end, false)
$$;

create or replace function private.can_review_as_da(p_request uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(private.justice_role_of(p_user) = 'district_attorney', false)
     and exists (select 1 from public.legal_requests r
                 where r.id = p_request and r.submitted_to_doj_at is not null)
$$;

create or replace function private.can_review_as_ag(p_request uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(private.justice_role_of(p_user) = 'attorney_general', false)
     and exists (select 1 from public.legal_requests r
                 where r.id = p_request and r.submitted_to_doj_at is not null)
$$;

create or replace function private.can_manage_legal_assignment(p_request uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(private.justice_role_of(p_user) in ('district_attorney', 'attorney_general'), false)
      or private.owner_flag(p_user)
$$;

create or replace function public.admin_justice_membership_requests()
returns setof public.justice_membership_requests
language plpgsql security definer set search_path to '' as $$
begin
  if not (coalesce(private.justice_role() in ('district_attorney', 'attorney_general'), false)
          or coalesce((select is_owner and removed_at is null from public.profiles
                       where id = (select auth.uid())), false)) then
    raise exception 'not authorized';
  end if;
  return query select * from public.justice_membership_requests
   order by submitted_at desc nulls last, created_at desc;
end $$;

create or replace function public.legal_internal_notes(p_request uuid)
returns table (id uuid, actor_id uuid, action text, internal_note text, created_at timestamptz)
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests;
begin
  select * into r from public.legal_requests where id = p_request;
  if not found then raise exception 'request not found'; end if;
  if not (coalesce(r.assigned_ada_id = v_uid, false)
          or coalesce(r.assigned_judge_id = v_uid, false)
          or coalesce(private.justice_role_of(v_uid) in ('district_attorney', 'attorney_general'), false)
          or private.owner_flag(v_uid)) then
    raise exception 'not authorized';
  end if;
  return query
    select a.id, a.actor_id, a.action, a.internal_note, a.created_at
      from public.legal_request_actions a
     where a.legal_request_id = p_request and a.internal_note is not null
     order by a.created_at;
end $$;

-- close_legal_request: only the revoke branch changes (NULL-safe judge check).
create or replace function public.close_legal_request(
  p_request uuid, p_outcome text default 'closed', p_note text default null)
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.fulfilment_status = 'closed' then raise exception 'request is already closed'; end if;
  if p_outcome not in ('closed', 'expired', 'revoked') then raise exception 'invalid outcome'; end if;

  if p_outcome = 'revoked' then
    if not (coalesce(v_uid = r.assigned_judge_id, false)
            and coalesce(private.justice_role_of(v_uid) = 'judge', false))
       and not private.can_manage_legal_assignment(p_request, v_uid) then
      raise exception 'only the assigned Judge, DOJ management, or the Owner may revoke';
    end if;
    if btrim(coalesce(p_note, '')) = '' then raise exception 'a revocation reason is required'; end if;
    update public.legal_requests
       set fulfilment_status = 'revoked', revoked_at = now(), revoked_by = v_uid,
           revoke_reason = p_note
     where id = p_request returning * into r;
    perform private.legal_log(p_request, r.current_version_id, 'revoked', null, 'revoked', p_note, null);
    perform private.legal_audit(p_request, 'LEGAL_REVOKED', jsonb_build_object('reason', left(p_note, 200)));
    perform private.mdt_project(p_request, 'revoked');
    perform private.legal_notify(r.created_by, p_request, 'legal_update',
      'Your ' || r.request_type || ' was revoked.');
    return r;
  end if;

  if p_outcome = 'expired' then
    if not (private.can_fulfil_legal(p_request, v_uid)
            or private.can_manage_legal_assignment(p_request, v_uid)) then
      raise exception 'not authorized';
    end if;
    if r.expires_at is null or r.expires_at > now() then
      raise exception 'this request has not reached its expiration';
    end if;
    update public.legal_requests set fulfilment_status = 'expired'
     where id = p_request returning * into r;
    perform private.legal_log(p_request, r.current_version_id, 'expired', null, 'expired', null, null);
    perform private.legal_audit(p_request, 'LEGAL_EXPIRED', null);
    perform private.mdt_project(p_request, 'expired');
    return r;
  end if;

  -- closed
  if not (private.can_fulfil_legal(p_request, v_uid)
          or private.can_manage_legal_assignment(p_request, v_uid)) then
    raise exception 'not authorized';
  end if;
  if r.review_status not in ('approved', 'denied', 'withdrawn') then
    raise exception 'only decided or withdrawn requests can be closed';
  end if;
  update public.legal_requests
     set fulfilment_status = 'closed', closed_at = now(), closed_by = v_uid,
         close_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_request returning * into r;
  perform private.legal_log(p_request, r.current_version_id, 'closed', null, 'closed', p_note, null);
  perform private.legal_audit(p_request, 'LEGAL_CLOSED', null);
  if r.request_type = 'warrant' and exists (
      select 1 from public.mdt_wanted_projections m
      where m.legal_request_id = p_request and m.wanted_status = 'wanted') then
    perform private.mdt_project(p_request, 'cleared');
  end if;
  return r;
end $$;
