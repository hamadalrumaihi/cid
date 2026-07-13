-- Name resolution for justice-only users. profiles RLS is CID-scoped
-- (self OR private.is_active()), so DOJ/Judge users cannot read the roster —
-- these two definer RPCs expose exactly the names their screens need and
-- nothing else (no emails, no CID role/bureau details beyond what the legal
-- workflow already shows).

-- The justice roster: who holds which justice role (queues, judge pickers,
-- DOJ personnel boards). Callers: active justice members, active CID members
-- (they see prosecutor names on their requests), Owner.
create or replace function public.justice_directory()
returns table (
  user_id uuid, display_name text, agency text, justice_role text,
  active boolean, justice_identifier text)
language sql stable security definer set search_path to '' as $$
  select m.user_id, p.display_name, m.agency, m.justice_role, m.active, m.justice_identifier
    from public.justice_memberships m
    join public.profiles p on p.id = m.user_id
   where p.removed_at is null
     and (private.justice_role() is not null
          or private.is_active()
          or private.owner_flag((select auth.uid())))
   order by p.display_name
$$;
revoke all on function public.justice_directory() from public;
grant execute on function public.justice_directory() to authenticated, service_role;

-- Display names for everyone attached to ONE legal request the caller can
-- already view (creator, supervisor, prosecutors, judge, participants,
-- action actors) — request-specific access, never a roster bypass.
create or replace function public.legal_request_people(p_request uuid)
returns table (id uuid, display_name text)
language plpgsql stable security definer set search_path to '' as $$
begin
  if not private.can_view_legal_request(p_request, (select auth.uid())) then
    raise exception 'not authorized';
  end if;
  return query
    select distinct p.id, p.display_name
      from public.profiles p
     where p.id in (
       select r.created_by from public.legal_requests r where r.id = p_request
       union select r.cid_reviewed_by from public.legal_requests r where r.id = p_request
       union select r.assigned_ada_id from public.legal_requests r where r.id = p_request
       union select r.assigned_judge_id from public.legal_requests r where r.id = p_request
       union select r.decided_by from public.legal_requests r where r.id = p_request
       union select r.issued_by from public.legal_requests r where r.id = p_request
       union select r.executed_by from public.legal_requests r where r.id = p_request
       union select r.served_by from public.legal_requests r where r.id = p_request
       union select pa.user_id from public.legal_request_participants pa where pa.legal_request_id = p_request
       union select a.actor_id from public.legal_request_actions a where a.legal_request_id = p_request);
end $$;
revoke all on function public.legal_request_people(uuid) from public;
grant execute on function public.legal_request_people(uuid) to authenticated, service_role;
