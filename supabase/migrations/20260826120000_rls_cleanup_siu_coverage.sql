-- ============================================================================
-- rls_test_cleanup(): cover the SIU tables added after Phase 1.
--
-- FOUND during the pre-enablement safety review of the RLS suites
-- (docs/TEST-ENVIRONMENT.md). public.rls_test_cleanup() sweeps
-- siu_memberships / siu_case_agents / siu_compartment_members, which is
-- everything SIU Phase 1 had. Ten SIU tables have shipped since:
--
--   siu_targets  siu_case_notes  siu_disclosures  siu_sources
--   siu_undercover_operations  siu_financial_intel  siu_comms_intel
--   siu_integrity_reviews  siu_exports
--
-- All of them cascade from public.cases, so a row attached to a case a
-- FIXTURE CREATED is already removed when that case is deleted. The gap is a
-- row attached to a case the fixture did NOT create — which §12 and §15 make
-- possible by design:
--
--   * siu_case_notes keys to ANY case, including a live CID one (that is the
--     whole point of the SIU-only intelligence layer);
--   * siu_disclosures.target_case_id points AT a CID case, and an
--     audience='cid' release is visible division-wide to every active member.
--
-- A future test that released intelligence against a real case would leave
-- live, division-visible rows behind after cleanup. Nothing in the suites does
-- that today; nothing prevented it either.
--
-- ── Scoping ────────────────────────────────────────────────────────────────
-- Every branch below keys on AUTHORSHIP BY A FIXTURE ACCOUNT (created_by /
-- released_by / handler_id / exported_by = any(ids)), never on a case id
-- alone. A row a real agent wrote is never touched, even on a fixture case —
-- the cascade already handles that one, and matching on authorship keeps this
-- function's blast radius inside the fixture namespace by construction.
--
-- This does NOT address findings F1–F5 (the pre-existing author-keyed branches
-- on reports / operations / role_events / surveillance, and the F4 write to
-- real cases.lead_detective_id). Those change existing cleanup semantics and
-- are left for a deliberate decision — see the safety review.
--
-- ADDITIVE ONLY: one function body re-emitted. No schema change, and a no-op
-- unless an rls-test account calls it.
--
-- APPLICATION NOTE: applied live as rls_cleanup_siu_coverage.
-- ============================================================================

create or replace function public.rls_test_cleanup()
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  ids uuid[];
  caller uuid := (select auth.uid());
  case_ids uuid[];
  legal_ids uuid[];
  disp_ids uuid[];
  n_cases int; n_reports int; n_evidence int; n_feedback int; n_requests int;
  n_legal int; n_justice int; n_transfers int; n_tokens int; n_ledger int; n_disposables int;
  n_operations int; n_siu int; n_siu_rows int;
begin
  select array_agg(id) into ids from auth.users where email like 'rls-test-%@cidportal.test';
  if caller is null or ids is null or not (caller = any(ids)) then
    raise exception 'rls_test_cleanup: caller is not an RLS test account';
  end if;

  select coalesce(array_agg(id), '{}') into case_ids from public.cases where created_by = any(ids);
  select coalesce(array_agg(id), '{}') into legal_ids
    from public.legal_requests where created_by = any(ids) or case_id = any(case_ids);

  perform private.rls_test_cleanup_surveillance(ids, case_ids);

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

  -- ── SIU (Phase 1) ─────────────────────────────────────────────────────────
  delete from public.siu_compartment_members
    where case_id = any(case_ids) or user_id = any(ids);
  delete from public.siu_case_agents
    where case_id = any(case_ids) or user_id = any(ids);
  delete from public.siu_memberships where user_id = any(ids);
  get diagnostics n_siu = row_count;

  -- ── SIU (Phase 2, §15 and Phase 3) ────────────────────────────────────────
  -- Keyed on fixture AUTHORSHIP so a row on a real case cannot survive the
  -- run, and a real agent's row can never be caught. Cases the fixture created
  -- are handled by the cascade below either way.
  delete from public.siu_exports where exported_by = any(ids);
  get diagnostics n_siu_rows = row_count;
  delete from public.siu_disclosures where released_by = any(ids);
  delete from public.siu_integrity_reviews where created_by = any(ids);
  delete from public.siu_comms_intel where created_by = any(ids);
  delete from public.siu_financial_intel where created_by = any(ids);
  delete from public.siu_undercover_operations
    where created_by = any(ids) or handler_id = any(ids) or agent_id = any(ids);
  delete from public.siu_sources
    where created_by = any(ids) or handler_id = any(ids);
  delete from public.siu_case_notes where created_by = any(ids);
  delete from public.siu_targets where created_by = any(ids);

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
  delete from public.operation_case_links where case_id = any(case_ids);
  -- A fixture case under assumed SIU control still belongs to the fixture that
  -- created it (created_by is never rewritten by siu_assume_control), so it is
  -- already in case_ids and deletes here regardless of its authority.
  delete from public.cases where id = any(case_ids);
  get diagnostics n_cases = row_count;

  delete from public.operations where created_by = any(ids);
  get diagnostics n_operations = row_count;

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
    'operations', n_operations, 'siu_memberships', n_siu, 'siu_exports', n_siu_rows);
end $$;

-- ============================================================================
-- Rollback: re-emit public.rls_test_cleanup() from
-- 20260820120000_siu_phase1.sql (the Phase 1 version, without the Phase 2/3
-- SIU sweep).
-- ============================================================================
