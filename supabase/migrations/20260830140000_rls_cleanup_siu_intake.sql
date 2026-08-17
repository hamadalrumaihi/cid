-- ============================================================================
-- rls_test_cleanup() must sweep the SIU intake tables too.
--
-- 20260830120000 added public.siu_referrals and public.siu_conflicts. Neither
-- was in the cleanup sweep, so a fixture referral would have survived every run
-- and accumulated in the live intake queue.
--
-- Both follow the SIU rule established in 20260827120000: fixture-owned SIU
-- rows are REMOVED even when they escape the namespace, because leaving them is
-- strictly worse than removing them, and they have no real co-author. The
-- escape is reported in `leaked` either way, so it still turns the build red.
--
-- The referral case is the sharpest instance of that rule. A referral is an
-- ALLEGATION AGAINST A NAMED PERSON. A fixture-submitted one naming a real
-- officer would sit in the queue that every SIU field agent reads, and CID
-- cannot see it to challenge it. Deleting it is not tidiness, it is the only
-- defensible outcome.
--
-- ADDITIVE ONLY: one function body re-emitted. Everything outside the SIU
-- intake block and the new counter is verbatim from 20260827120000.
--
-- APPLICATION NOTE: applied live as rls_cleanup_siu_intake.
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
  blocked_disp uuid[];
  leaked jsonb := '[]'::jsonb;
  n int;
  n_cases int; n_reports int; n_evidence int; n_feedback int; n_requests int;
  n_legal int; n_justice int; n_transfers int; n_tokens int; n_ledger int; n_disposables int;
  n_operations int; n_siu int; n_siu_rows int; n_siu_intake int;
begin
  select array_agg(id) into ids from auth.users where email like 'rls-test-%@cidportal.test';
  if caller is null or ids is null or not (caller = any(ids)) then
    raise exception 'rls_test_cleanup: caller is not an RLS test account';
  end if;

  select coalesce(array_agg(id), '{}') into case_ids from public.cases where created_by = any(ids);
  select coalesce(array_agg(id), '{}') into legal_ids
    from public.legal_requests where created_by = any(ids) or case_id = any(case_ids);

  leaked := leaked || private.rls_test_cleanup_surveillance(ids, case_ids);

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

  -- ── SIU ───────────────────────────────────────────────────────────────────
  -- Fixture-owned test data with no real co-author. Left in place on a real
  -- case it would be live, division-visible intelligence CID cannot even see
  -- to question — so these ARE removed, and the escape is reported.
  delete from public.siu_compartment_members
    where case_id = any(case_ids) or user_id = any(ids);
  delete from public.siu_case_agents
    where case_id = any(case_ids) or user_id = any(ids);
  delete from public.siu_memberships where user_id = any(ids);
  get diagnostics n_siu = row_count;

  select count(*) into n from public.siu_case_notes x
   where x.created_by = any(ids) and not (x.case_id = any(case_ids));
  if n > 0 then leaked := leaked || jsonb_build_object('surface', 'siu_case_notes on a non-fixture case (removed)', 'rows', n); end if;
  select count(*) into n from public.siu_disclosures x
   where x.released_by = any(ids) and x.target_case_id is not null and not (x.target_case_id = any(case_ids));
  if n > 0 then leaked := leaked || jsonb_build_object('surface', 'siu_disclosures targeting a non-fixture case (removed)', 'rows', n); end if;

  -- Intake (20260830120000). A fixture referral can NAME a real member as its
  -- subject or point at a real case. Leaving one is worse than removing it: an
  -- unfounded test allegation against a real officer, sitting live in the SIU
  -- queue, readable by every field agent. So it is removed AND reported.
  select count(*) into n from public.siu_referrals r
   where r.submitted_by = any(ids)
     and ((r.subject_user_id is not null and not (r.subject_user_id = any(ids)))
       or (r.related_case_id is not null and not (r.related_case_id = any(case_ids))));
  if n > 0 then leaked := leaked || jsonb_build_object('surface', 'siu_referrals naming a real subject or case (removed)', 'rows', n); end if;

  -- A conflict row is a RECUSAL: while it exists its agent is walled out of the
  -- case. It is agent-keyed, so it can only ever wall out a fixture -- but a
  -- stale one on a real case would silently keep that fixture locked out of
  -- every later run, so it goes.
  select count(*) into n from public.siu_conflicts k
   where k.agent_id = any(ids) and not (k.case_id = any(case_ids));
  if n > 0 then leaked := leaked || jsonb_build_object('surface', 'siu_conflicts on a non-fixture case (removed)', 'rows', n); end if;

  delete from public.siu_conflicts where agent_id = any(ids) or acknowledged_by = any(ids);
  delete from public.siu_referrals
    where submitted_by = any(ids) or reviewed_by = any(ids) or subject_user_id = any(ids);
  get diagnostics n_siu_intake = row_count;

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

  -- F1. Case-scoped only: a fixture-authored report on a REAL case changes
  -- what that case contains and may be interleaved with real work.
  delete from public.reports where case_id = any(case_ids);
  get diagnostics n_reports = row_count;
  select count(*) into n from public.reports r
   where r.author_id = any(ids) and not (r.case_id = any(case_ids));
  if n > 0 then leaked := leaked || jsonb_build_object('surface', 'reports.author_id on a non-fixture case', 'rows', n); end if;

  delete from public.feedback where created_by = any(ids);
  get diagnostics n_feedback = row_count;
  delete from public.notifications where user_id = any(ids);
  delete from public.transfer_requests where target_id = any(ids) or requested_by = any(ids);
  get diagnostics n_transfers = row_count;

  -- F3. Only events ABOUT a fixture account. An event a fixture ACTED on for a
  -- real member is that member's assignment provenance and is never deleted.
  delete from public.role_events where target_id = any(ids);
  select count(*) into n from public.role_events e
   where e.actor_id = any(ids) and not (e.target_id = any(ids));
  if n > 0 then leaked := leaked || jsonb_build_object('surface', 'role_events.actor_id against a real member', 'rows', n); end if;

  delete from public.client_errors where reporter_id = any(ids);
  delete from public.membership_request_history where request_id in
    (select id from public.membership_requests where applicant_id = any(ids));
  delete from public.membership_requests where applicant_id = any(ids);
  get diagnostics n_requests = row_count;
  delete from public.announcements where author_id = any(ids);
  delete from public.operation_case_links where case_id = any(case_ids);
  delete from public.cases where id = any(case_ids);
  get diagnostics n_cases = row_count;

  -- F2. A fixture-created operation is cleanup's — unless it links a real
  -- case, where the cascade would strip that case's joint access.
  delete from public.operations o
   where o.created_by = any(ids)
     and not exists (select 1 from public.operation_case_links l
                      where l.operation_id = o.id and not (l.case_id = any(case_ids)));
  get diagnostics n_operations = row_count;
  select count(*) into n from public.operations o
   where o.created_by = any(ids)
     and exists (select 1 from public.operation_case_links l
                  where l.operation_id = o.id and not (l.case_id = any(case_ids)));
  if n > 0 then leaked := leaked || jsonb_build_object('surface', 'operations linked to a non-fixture case', 'rows', n); end if;

  delete from public.deletion_tokens where created_by = any(ids) or target_id = any(ids);
  get diagnostics n_tokens = row_count;
  delete from public.deleted_member_ledger where email like 'rls-test-disposable-%@cidportal.test';
  get diagnostics n_ledger = row_count;

  -- F4. Never write to a real case or gang. A disposable still referenced by
  -- one is left undeleted (an inactive stray profile beats a mutated case).
  select coalesce(array_agg(id), '{}') into disp_ids
    from auth.users where email like 'rls-test-disposable-%@cidportal.test';
  select coalesce(array_agg(distinct u), '{}') into blocked_disp from (
    select c.lead_detective_id as u from public.cases c
     where c.lead_detective_id = any(disp_ids) and not (c.id = any(case_ids))
    union
    select g.lead_detective_id from public.gangs g where g.lead_detective_id = any(disp_ids)
  ) s;
  if array_length(blocked_disp, 1) > 0 then
    leaked := leaked || jsonb_build_object(
      'surface', 'disposable fixture leads a real case/gang — profile retained, record untouched',
      'rows', array_length(blocked_disp, 1));
  end if;

  update public.cases set lead_detective_id = null
   where lead_detective_id = any(disp_ids) and id = any(case_ids);
  delete from public.profiles where id = any(disp_ids) and not (id = any(blocked_disp));
  delete from auth.users where id = any(disp_ids) and not (id = any(blocked_disp));
  get diagnostics n_disposables = row_count;

  return jsonb_build_object('cases', n_cases, 'reports', n_reports, 'evidence', n_evidence,
    'feedback', n_feedback, 'membership_requests', n_requests,
    'legal_requests', n_legal, 'justice_requests', n_justice, 'transfer_requests', n_transfers,
    'deletion_tokens', n_tokens, 'ledger_rows', n_ledger, 'disposables', n_disposables,
    'operations', n_operations, 'siu_memberships', n_siu, 'siu_exports', n_siu_rows,
    'siu_referrals', n_siu_intake,
    'leaked', leaked);
end $$;

-- ============================================================================
-- Rollback: re-emit public.rls_test_cleanup() from
-- 20260827120000_rls_cleanup_namespace_wall.sql. Doing so stops cleaning
-- siu_referrals / siu_conflicts, so fixture referrals will accumulate in the
-- live intake queue.
-- ============================================================================
