-- ─────────────────────────────────────────────────────────────────────────────
-- rls_test_cleanup learns to purge the standalone registry entities the suites
-- create — so the live RLS suites stop leaking rows into production.
--
-- The suites authenticate as the durable rls-test-* fixtures and, besides
-- cases (already purged here), create registry rows OUTSIDE any case:
-- documents (v131), narcotics + places (v133/v143), gangs, persons, and their
-- suggestions. Nothing removed those, so a crashed run — or the doc suite's
-- per-row afterAll being skipped — left them published in the live SOPs
-- library, Narcotics registry, etc. (24 SOP docs, 4 narcotics, 1 place were
-- found and removed by hand on 2026-07-18; this closes the source).
--
-- Every child of these six parents CASCADEs or SET NULLs on delete (verified
-- against the live catalog), so deleting the fixture-authored parent is
-- sufficient and never FK-violates. Suggestions submitted by a fixture against
-- a REAL parent are removed by author so the real parent survives.
--
-- The whole body is re-emitted verbatim from the deployed definition (nothing
-- existing is dropped) with the new block inserted before the disposable-
-- account teardown, and six new counts added to the returned summary.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.rls_test_cleanup()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  ids uuid[];
  caller uuid := (select auth.uid());
  case_ids uuid[];
  legal_ids uuid[];
  disp_ids uuid[];
  n_cases int; n_reports int; n_evidence int; n_feedback int; n_requests int;
  n_legal int; n_justice int; n_transfers int; n_tokens int; n_ledger int; n_disposables int;
  n_documents int; n_narcotics int; n_gangs int; n_places int; n_vehicles int; n_persons int;
begin
  select array_agg(id) into ids from auth.users where email like 'rls-test-%@cidportal.test';
  if caller is null or ids is null or not (caller = any(ids)) then
    raise exception 'rls_test_cleanup: caller is not an RLS test account';
  end if;

  select coalesce(array_agg(id), '{}') into case_ids from public.cases where created_by = any(ids);
  select coalesce(array_agg(id), '{}') into legal_ids
    from public.legal_requests where created_by = any(ids) or case_id = any(case_ids);

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
  delete from public.transfer_requests where target_id = any(ids) or requested_by = any(ids);
  get diagnostics n_transfers = row_count;
  delete from public.role_events where target_id = any(ids) or actor_id = any(ids);
  delete from public.client_errors where reporter_id = any(ids);
  delete from public.membership_request_history where request_id in
    (select id from public.membership_requests where applicant_id = any(ids));
  delete from public.membership_requests where applicant_id = any(ids);
  get diagnostics n_requests = row_count;
  delete from public.announcements where author_id = any(ids);
  delete from public.cases where id = any(case_ids);
  get diagnostics n_cases = row_count;

  -- ── Standalone registry entities authored by fixtures ──────────────────────
  -- The pollution source: rows the suites create OUTSIDE a case. FK children of
  -- each parent cascade/set-null, so deleting the parent is enough. Suggestions
  -- a fixture filed against a REAL parent are removed by author, sparing the
  -- parent. gang_members pointing at a fixture person are dropped first so no
  -- orphaned (null-person) roster rows are left behind.
  delete from public.document_suggestions where created_by = any(ids);
  delete from public.documents where updated_by = any(ids) or owner_user_id = any(ids);
  get diagnostics n_documents = row_count;

  delete from public.narcotic_suggestions where created_by = any(ids);
  delete from public.narcotics where created_by = any(ids);
  get diagnostics n_narcotics = row_count;

  delete from public.gangs where created_by = any(ids);
  get diagnostics n_gangs = row_count;

  delete from public.places where created_by = any(ids);
  get diagnostics n_places = row_count;

  delete from public.vehicles where created_by = any(ids);
  get diagnostics n_vehicles = row_count;

  delete from public.gang_members where person_id in (select id from public.persons where created_by = any(ids));
  delete from public.persons where created_by = any(ids);
  get diagnostics n_persons = row_count;

  delete from public.deletion_tokens where created_by = any(ids) or target_id = any(ids);
  get diagnostics n_tokens = row_count;
  delete from public.deleted_member_ledger where email like 'rls-test-disposable-%@cidportal.test';
  get diagnostics n_ledger = row_count;
  select coalesce(array_agg(id), '{}') into disp_ids
    from auth.users where email like 'rls-test-disposable-%@cidportal.test';
  update public.cases set lead_detective_id = null where lead_detective_id = any(disp_ids);
  update public.gangs set lead_detective_id = null where lead_detective_id = any(disp_ids);
  delete from public.profiles where id = any(disp_ids);
  delete from auth.users where id = any(disp_ids);
  get diagnostics n_disposables = row_count;

  return jsonb_build_object('cases', n_cases, 'reports', n_reports, 'evidence', n_evidence,
    'feedback', n_feedback, 'membership_requests', n_requests,
    'legal_requests', n_legal, 'justice_requests', n_justice, 'transfer_requests', n_transfers,
    'deletion_tokens', n_tokens, 'ledger_rows', n_ledger, 'disposables', n_disposables,
    'documents', n_documents, 'narcotics', n_narcotics, 'gangs', n_gangs,
    'places', n_places, 'vehicles', n_vehicles, 'persons', n_persons);
end $function$;
