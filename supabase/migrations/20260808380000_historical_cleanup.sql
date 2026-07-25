-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 10 — historical-data cleanup (non-judicial pollution + true orphans)
-- and a recurrence fix for the RLS test-cleanup RPC.
--
-- SCOPE GUARDRAIL: the roadmap PRESERVES every historical judicial record
-- (AG/ADA/Judge/signature/decision/court-packet rows + justice memberships).
-- This migration touches NONE of them. A full read-only audit of the live DB
-- found the database already clean — 0 enforced-FK orphans, 0 NOT-VALID
-- constraints, 0 redundant indexes, 0 disposable-fixture leakage. The only
-- actionable surface was ~5 non-judicial rows, each deleted below by an
-- idempotent predicate (matches 0 rows on a fresh rebuild), verified live:
--
--   * 1 media row  — caseless, '[rls-test]' v153 fixture upload; NOT restricted
--     and NOT linked to any legal_seized_items (judicial guard verified = 0).
--   * 2 document_user_state rows — per-user document read-state owned by is_test
--     fixture accounts; regenerable, invisible to real users.
--   * 1 watchlist row — a personal case bookmark whose case was deleted.
--   * 1 case_files row — evidence-media metadata (linked to a case by
--     case_number TEXT, no FK) whose case was PERMANENTLY deleted; the
--     permanent-delete RPC does not cascade case_files, so it stranded.
--
-- Deliberately LEFT UNTOUCHED (preservation): all 7 legacy legal_requests and
-- their 28 versions / 42 actions / 45 exhibits / 21 participants / 14
-- signatures (decided under fixture ADA/Judge identities — preserved as-is, never
-- rewritten); all 10 justice_memberships + 4 prosecutor_bureau_assignments; the
-- 16 standing rls-test fixtures (is_test-hidden, RLS suites depend on them);
-- append-only audit_log / restricted_access_log; and all 132 unused indexes
-- (accepted-by-design on a low-traffic app). See the PR body for the full audit.
--
-- FOLLOW-UP (not done here, to keep a destructive RPC out of a cleanup
-- migration): teach the permanent-delete path to cascade case_files by
-- case_number so a future permanent delete cannot re-strand this row.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1) one-time cleanup of current pollution / orphans (all non-judicial) ────
delete from public.media
  where case_id is null and title ilike '[rls-test]%';

delete from public.document_user_state
  where user_id in (select id from public.profiles where is_test);

delete from public.watchlist w
  where w.target_type = 'case'
    and not exists (select 1 from public.cases c where c.id = w.target_id);

delete from public.case_files cf
  where not exists (select 1 from public.cases c where c.case_number = cf.case_number);

-- ── 2) recurrence fix — rls_test_cleanup() now sweeps caseless fixture media
--       and fixture document read-state. Body otherwise byte-identical to the
--       live definition (search_path='' preserved). Two edits, marked ▶ below.
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
  n_rag int; n_ral int;
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

  delete from public.restricted_access_log
    where actor_id = any(ids) or entity_id = any(case_ids)
       or entity_id in (select id from public.media where case_id = any(case_ids));
  get diagnostics n_ral = row_count;
  delete from public.restricted_access_grants
    where user_id = any(ids) or case_id = any(case_ids);
  get diagnostics n_rag = row_count;

  -- ▶ EDIT 1: also sweep caseless fixture-uploaded media (v153-style suites
  --   create restricted media with case_id = null; the old case-scoped delete
  --   left them stranded).
  delete from public.media
    where case_id = any(case_ids)
       or (uploaded_by = any(ids) and case_id is null);
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

  delete from public.document_suggestions where created_by = any(ids);
  -- ▶ EDIT 2: sweep fixture-owned document read-state (never cleaned before).
  delete from public.document_user_state where user_id = any(ids);
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
    'places', n_places, 'vehicles', n_vehicles, 'persons', n_persons,
    'restricted_grants', n_rag, 'restricted_log', n_ral);
end $function$;

revoke all on function public.rls_test_cleanup() from public;
revoke execute on function public.rls_test_cleanup() from anon;
grant execute on function public.rls_test_cleanup() to authenticated, service_role;

-- ============================================================================
-- Rollback (manual): the one-time deletes are not reversible (the rows were
-- pollution/orphans); re-emit rls_test_cleanup() from its prior definition to
-- drop the two added sweeps. Nothing judicial was touched.
-- ============================================================================
