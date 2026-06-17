-- Director = supreme role, above all ranks (per CID SOP Title 2A.1: the CID
-- Director is the senior authority within the division). Grants Director full
-- administrative authority equal-or-above Command: member administration,
-- role/active/division changes, and all deletes.
--
-- This redefines private.is_command() to also accept 'director'. Every gate that
-- relied on is_command() (profiles_command policy, assign_member, the
-- self-escalation block) now treats Director as a full administrator. can_delete()
-- already included director. is_active()/role() are unchanged.

create or replace function private.is_command() returns boolean
  language sql stable security definer set search_path = '' as $$
  select coalesce((select active and role in ('director','command')
                   from public.profiles where id = (select auth.uid())), false) $$;

-- bootstrap helper: promote an email to Director (top of the hierarchy).
-- No internal guard (run from the SQL editor / service_role only); kept off the API.
create or replace function public.bootstrap_director(p_email text)
  returns text language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.profiles set role='director', active=true where email = p_email;
  get diagnostics n = row_count;
  return case when n>0 then 'Bootstrapped director: '||p_email else 'No profile with that email yet — sign in first.' end;
end $$;
revoke execute on function public.bootstrap_director(text) from anon, authenticated, public;
