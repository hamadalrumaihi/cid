-- Legal-request search (RLS-limited) + RLS test-suite cleanup coverage for
-- every table added by the DOJ build.

-- SECURITY INVOKER: results pass through the legal_requests SELECT policy, so
-- sealed requests are invisible to unauthorized users by construction — the
-- search cannot reveal their existence through hits, counts, or suggestions.
-- Classified narratives are NOT indexed: matching runs over the authorized
-- header fields only (§50).
create or replace function public.legal_search(q text)
returns setof public.legal_requests
language sql stable security invoker set search_path to '' as $$
  select r.* from public.legal_requests r
  where btrim(coalesce(q, '')) <> ''
    and (r.request_number ilike '%' || q || '%'
      or r.case_number_snapshot ilike '%' || q || '%'
      or r.title ilike '%' || q || '%'
      or r.person_name_snapshot ilike '%' || q || '%'
      or r.recipient_name ilike '%' || q || '%'
      or r.responsible_bureau::text ilike q
      or r.review_status ilike q
      or r.fulfilment_status ilike q)
  order by r.created_at desc
  limit 50
$$;
revoke all on function public.legal_search(text) from public;
grant execute on function public.legal_search(text) to authenticated, service_role;

-- Expired warrants must never read as actively wanted (§30/§55.60): the
-- current MDT status is computed against the clock at read time.
create or replace function public.mdt_wanted_current()
returns table (
  legal_request_id uuid, person_id uuid, person_name_snapshot text,
  wanted_status text, effective_status text, warrant_reference text,
  warrant_type text, issuing_judge_name text, issue_date timestamptz,
  expires_at timestamptz, classification_safe_warning text)
language sql stable security invoker set search_path to '' as $$
  select m.legal_request_id, m.person_id, m.person_name_snapshot,
         m.wanted_status,
         case when m.wanted_status = 'wanted' and m.expires_at is not null and m.expires_at < now()
              then 'expired' else m.wanted_status end,
         m.warrant_reference, m.warrant_type, m.issuing_judge_name,
         m.issue_date, m.expires_at, m.classification_safe_warning
    from public.mdt_wanted_projections m
$$;
revoke all on function public.mdt_wanted_current() from public;
grant execute on function public.mdt_wanted_current() to authenticated, service_role;

-- Cleanup: add the justice/legal tables so the live suite stays repeatable.
create or replace function public.rls_test_cleanup()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  ids uuid[];
  caller uuid := (select auth.uid());
  case_ids uuid[];
  legal_ids uuid[];
  n_cases int; n_reports int; n_evidence int; n_feedback int; n_requests int;
  n_legal int; n_justice int;
begin
  select array_agg(id) into ids from auth.users where email like 'rls-test-%@cidportal.test';
  if caller is null or ids is null or not (caller = any(ids)) then
    raise exception 'rls_test_cleanup: caller is not an RLS test account';
  end if;

  select coalesce(array_agg(id), '{}') into case_ids from public.cases where created_by = any(ids);
  select coalesce(array_agg(id), '{}') into legal_ids
    from public.legal_requests where created_by = any(ids) or case_id = any(case_ids);

  -- Legal records first (they restrict-reference cases and reports).
  delete from public.mdt_wanted_projections where legal_request_id = any(legal_ids);
  delete from public.legal_request_signatures where legal_request_id = any(legal_ids);
  delete from public.legal_request_exhibits where legal_request_id = any(legal_ids);
  delete from public.legal_request_participants where legal_request_id = any(legal_ids);
  delete from public.legal_request_actions where legal_request_id = any(legal_ids);
  update public.legal_requests set current_version_id = null where id = any(legal_ids);
  delete from public.legal_request_versions where legal_request_id = any(legal_ids);
  delete from public.legal_requests where id = any(legal_ids);
  get diagnostics n_legal = row_count;

  delete from public.prosecutor_bureau_assignments
    where prosecutor_id = any(ids) or assigned_by = any(ids);
  delete from public.justice_membership_request_history where request_id in
    (select id from public.justice_membership_requests where applicant_id = any(ids));
  delete from public.justice_membership_requests where applicant_id = any(ids);
  get diagnostics n_justice = row_count;
  delete from public.justice_memberships where user_id = any(ids) and approved_by = any(ids);

  delete from public.case_messages where case_id = any(case_ids);
  delete from public.case_tasks where case_id = any(case_ids);
  delete from public.case_signoff_history where case_id = any(case_ids);
  delete from public.case_assignments where case_id = any(case_ids);
  delete from public.case_intel_links where case_id = any(case_ids);
  delete from public.case_files where case_number in (select case_number from public.cases where id = any(case_ids));
  delete from public.custody_chain where evidence_id in (select id from public.evidence where case_id = any(case_ids));
  delete from public.evidence where case_id = any(case_ids);
  get diagnostics n_evidence = row_count;
  delete from public.media where case_id = any(case_ids);
  delete from public.predicate_acts where rico_case_id in (select id from public.rico_cases where case_id = any(case_ids));
  delete from public.rico_cases where case_id = any(case_ids);
  delete from public.reports where case_id = any(case_ids) or author_id = any(ids);
  get diagnostics n_reports = row_count;
  delete from public.feedback where created_by = any(ids);
  get diagnostics n_feedback = row_count;
  delete from public.notifications where user_id = any(ids);
  delete from public.role_events where target_id = any(ids) or actor_id = any(ids);
  delete from public.client_errors where reporter_id = any(ids);
  delete from public.membership_request_history where request_id in
    (select id from public.membership_requests where applicant_id = any(ids));
  delete from public.membership_requests where applicant_id = any(ids);
  get diagnostics n_requests = row_count;
  delete from public.announcements where author_id = any(ids);
  delete from public.cases where id = any(case_ids);
  get diagnostics n_cases = row_count;

  return jsonb_build_object('cases', n_cases, 'reports', n_reports, 'evidence', n_evidence,
    'feedback', n_feedback, 'membership_requests', n_requests,
    'legal_requests', n_legal, 'justice_requests', n_justice);
end $$;
