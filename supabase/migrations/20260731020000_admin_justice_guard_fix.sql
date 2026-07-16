-- ============================================================================
-- SECURITY FIX: admin_justice_membership_requests() authorization bypass.
--
-- WHAT: 20260714070000 (legal_null_guards) coalesced this RPC's guard because
-- private.justice_role() returns NULL for non-justice callers and
-- `NULL in (...)` is NULL — `if not (NULL or false)` silently SKIPS the
-- raise. 20260719020000 (hide_test_fixtures) then redefined the function to
-- add the is_test row filtering and REINTRODUCED the un-coalesced guard:
-- since July 19 ANY authenticated user (justice-less detectives, inactive
-- applicants) could call this SECURITY DEFINER RPC and read every justice
-- membership request INCLUDING internal_decision_note, which the column
-- grants deliberately revoke from clients.
--
-- Caught live by the v130 suite's "command holds NO judiciary decision
-- authority" pin (the CID director fixture expected 'not authorized' and got
-- rows instead). Body below = the live one (with the fixture filtering)
-- plus the restored coalesce — nothing else changes.
--
-- WHY same-day as 20260731010000: that migration pins Owner/AG-only review
-- authority; an open reviewer-notes reader would contradict it.
-- ============================================================================

create or replace function public.admin_justice_membership_requests()
returns setof public.justice_membership_requests
language plpgsql security definer set search_path to '' as $$
begin
  if not (coalesce(private.justice_role() in ('district_attorney', 'attorney_general'), false)
          or coalesce((select is_owner and removed_at is null from public.profiles
                       where id = (select auth.uid())), false)) then
    raise exception 'not authorized';
  end if;
  return query select r.* from public.justice_membership_requests r
   where not private.is_test_user(r.applicant_id)
      or private.is_test_user((select auth.uid()))
   order by r.submitted_at desc nulls last, r.created_at desc;
end $$;
-- Grants preserved by CREATE OR REPLACE on the unchanged signature
-- (authenticated + service_role per 20260714010000).

-- ============================================================================
-- Rollback (manual): none sensible — the previous body is the vulnerability.
-- ============================================================================
