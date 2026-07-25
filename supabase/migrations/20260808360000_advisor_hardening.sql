-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 9 — advisor hardening (grants / search_path / one policy / FK indexes).
--
-- Source: full Supabase advisor digest of the live project (zero ERROR-level
-- findings; this migration clears the actionable WARN/INFO items). Four parts,
-- all defense-in-depth or performance — no behavior change for the app:
--
-- 1) ANON EXECUTE DRIFT (51 RPCs + 1 trigger fn). Project convention is
--    anon-revoked on every RPC, but these kept the role's creation-time
--    EXECUTE grant (cid_touch_updated_at is a trigger function — PostgREST
--    cannot invoke it as an RPC and trigger firing bypasses the EXECUTE check,
--    so its revoke is cosmetic drift-cleanup, not an exposure fix). The drift
--    mechanism: their creation waves ran `revoke ... from public` (or nothing)
--    without `from anon`, and Supabase's default privileges
--    (ALTER DEFAULT PRIVILEGES FOR ROLE postgres ... GRANT ALL ON FUNCTIONS TO
--    postgres, anon, authenticated, service_role) had already given anon an
--    EXPLICIT grant that a public-revoke does not touch. No exposure occurred —
--    every one of these gates on auth.uid()/is_active()/role checks that
--    collapse without a session — but the only thing between an unauthenticated
--    client and a SECURITY DEFINER body was that body's own first lines.
--    Signatures below are the LIVE signatures, resolved from the last migration
--    that (re)defined each function; none are overloaded today
--    (assign_member(uuid, app_role, bureau, boolean) was dropped by
--    20260718010000/20260807120000 — only (uuid, boolean) remains).
--    authenticated / service_role grants are NOT touched.
--
--    Test note: no RLS suite calls any of these as anon expecting success —
--    the single anon probe (rls.test.ts: rls_test_cleanup) asserts a non-null
--    error either way, so the switch from an in-body raise to permission-denied
--    changes no assertion outcome.
--
-- 2) ANTI-DRIFT DEFAULT: the postgres defacl for functions in public loses
--    anon + PUBLIC, so FUTURE functions are born without the anonymous grant.
--    Supabase's defaults still grant authenticated + service_role (that part of
--    the defacl is left intact) — new RPCs keep working for signed-in members
--    without a per-function grant line.
--
-- 3) SEARCH_PATH PIN: private.case_number_base(text) was the one function left
--    unpinned (20260808120000). Its body is a pure CASE expression over its
--    argument — upper()/coalesce() from pg_catalog, no table or public.*
--    references — so a bare ALTER ... SET search_path = '' is safe (verified
--    against the body; no re-emit needed).
--
-- 4) client_errors_ins tightened from WITH CHECK (true): a member could insert
--    an error row attributed to ANY other member (reporter_id spoof). The
--    client reporter (src/lib/errorReport.ts) never sets reporter_id — the
--    column default auth.uid() fills it — so binding reporter_id to the caller
--    (or NULL, preserving the column's ON DELETE SET NULL / explicit-anonymous
--    shape) breaks nothing. Other clauses (FOR INSERT TO authenticated,
--    permissive) preserved; owner-only SELECT/DELETE policies untouched.
--
-- 5) 67 FK COVERING INDEXES (advisor INFO 0001_unindexed_foreign_keys): every
--    unindexed FK gets a plain btree covering index, named <table>_<col>_idx.
--    Verified against the schema snapshot that none of the 67 is already
--    covered under another name (the advisor treats an existing PARTIAL index
--    as covering — legal_holds.case_id, mdt_exports.person_id, accounts.
--    merged_into etc. are therefore correctly absent from this list). Mostly
--    audit/actor columns: the win is fast FK-side lookups and, above all,
--    cheap cascades/SET NULLs when profiles / cases / versions are deleted
--    (Phase B permanent deletion walks many of these).
--
-- Rollback: re-grant EXECUTE to anon per function / re-add the defacl grant /
-- drop the indexes / restore WITH CHECK (true). Nothing here alters data.
-- ─────────────────────────────────────────────────────────────────────────────

-- ══════════════════════════════════════════════════════════════════════════
-- 1) Revoke anon EXECUTE on the 51 drifted RPCs + 1 trigger fn (live signatures)
-- ══════════════════════════════════════════════════════════════════════════

revoke execute on function public.admin_membership_requests() from public, anon;
revoke execute on function public.announcement_notify_update(uuid) from public, anon;
revoke execute on function public.announcement_recipient_count(text, jsonb) from public, anon;
revoke execute on function public.approve_transfer_source(uuid, text) from public, anon;
revoke execute on function public.approve_transfer_target(uuid, text) from public, anon;
revoke execute on function public.assign_member(uuid, boolean) from public, anon;
revoke execute on function public.cancel_transfer(uuid) from public, anon;
revoke execute on function public.case_reassign_bureau(uuid, public.bureau, text, boolean) from public, anon;
revoke execute on function public.change_member_role(uuid, public.app_role, text) from public, anon;
revoke execute on function public.cid_touch_updated_at() from public, anon;  -- trigger fn: cosmetic drift-cleanup (not RPC-exposable)
revoke execute on function public.close_legal_request(uuid, text, text) from public, anon;
revoke execute on function public.complete_transfer(uuid) from public, anon;
revoke execute on function public.convert_case_to_joint(uuid, jsonb, text) from public, anon;
revoke execute on function public.correct_membership_organization(uuid, text, text, text, public.bureau, public.app_role) from public, anon;
revoke execute on function public.create_legal_request(uuid, text, text, text, text, jsonb, text, uuid, text, text, uuid, text) from public, anon;
revoke execute on function public.deny_member_login(uuid, text) from public, anon;
revoke execute on function public.doj_bureau_coverage() from public, anon;
revoke execute on function public.import_legal_warrant(uuid, text, text, text, jsonb, text, uuid, text, timestamptz, uuid, text, jsonb) from public, anon;
revoke execute on function public.import_rollback_by_key(text) from public, anon;
revoke execute on function public.issue_legal_request(uuid, timestamptz, timestamptz) from public, anon;
revoke execute on function public.joint_case_add_members(uuid, jsonb) from public, anon;
revoke execute on function public.joint_case_end(uuid, text) from public, anon;
revoke execute on function public.joint_case_remove_member(uuid, uuid, text) from public, anon;
revoke execute on function public.justice_directory() from public, anon;
revoke execute on function public.legal_internal_notes(uuid) from public, anon;
revoke execute on function public.legal_request_people(uuid) from public, anon;
revoke execute on function public.legal_search(text) from public, anon;
revoke execute on function public.mdt_wanted_current() from public, anon;
revoke execute on function public.membership_request_submit(uuid) from public, anon;
revoke execute on function public.membership_request_withdraw(uuid) from public, anon;
revoke execute on function public.owner_security_overview() from public, anon;
revoke execute on function public.permanent_delete_arm(uuid, text) from public, anon;
revoke execute on function public.permanent_delete_execute(uuid, text) from public, anon;
revoke execute on function public.permanent_delete_preview(uuid) from public, anon;
revoke execute on function public.publish_announcement(text, text, text, jsonb, jsonb, boolean) from public, anon;
revoke execute on function public.record_subpoena_compliance(uuid, text, text, text, timestamptz) from public, anon;
revoke execute on function public.record_subpoena_service(uuid, text, text, text, boolean, timestamptz) from public, anon;
revoke execute on function public.reject_transfer(uuid, text) from public, anon;
revoke execute on function public.remove_legal_exhibit(uuid) from public, anon;
revoke execute on function public.report_reopen(uuid) from public, anon;
revoke execute on function public.resolve_case_originating_bureau(uuid, public.bureau) from public, anon;
revoke execute on function public.restore_member_login(uuid) from public, anon;
revoke execute on function public.review_membership_request(uuid, text, public.bureau, public.app_role, text, text) from public, anon;
revoke execute on function public.rls_test_cleanup() from public, anon;
revoke execute on function public.rls_test_reset_member(uuid, public.app_role, public.bureau, boolean) from public, anon;
revoke execute on function public.rls_test_spawn_disposable(text) from public, anon;
revoke execute on function public.security_test_report(text, integer, integer, integer, jsonb, text, text, text, text, integer) from public, anon;
revoke execute on function public.set_profile_test_flag(uuid, boolean) from public, anon;
revoke execute on function public.signoff_command_override(uuid, text, text) from public, anon;
revoke execute on function public.update_legal_draft(uuid, text, text, jsonb, text, uuid, text, text, text) from public, anon;
revoke execute on function public.warrant_set_status(uuid, text) from public, anon;
revoke execute on function public.withdraw_legal_request(uuid, text) from public, anon;

-- ══════════════════════════════════════════════════════════════════════════
-- 2) Anti-drift default: future functions are born without the anon grant
-- ══════════════════════════════════════════════════════════════════════════
-- Supabase's initial schema sets the function defacl FOR ROLE postgres
-- (GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role) and
-- migrations execute as postgres (the snapshot's column ACLs show postgres as
-- grantor), so the FOR ROLE form edits the exact defacl entry that has been
-- minting the drift. The plain form (defacl of the CURRENT role) is emitted as
-- well as a belt-and-braces duplicate: when the executor IS postgres the two
-- statements are identical (idempotent), and if a migration ever runs as a
-- different role its own defacl is scrubbed too. authenticated + service_role
-- keep their default EXECUTE from Supabase's untouched grants — new RPCs still
-- work for signed-in members with no per-function grant line.

alter default privileges for role postgres in schema public revoke execute on functions from anon, public;
alter default privileges in schema public revoke execute on functions from anon, public;

-- ══════════════════════════════════════════════════════════════════════════
-- 3) Pin search_path on the one unpinned function
-- ══════════════════════════════════════════════════════════════════════════
-- Body (20260808120000) is a pure CASE over p_bureau using only pg_catalog
-- functions (upper/coalesce) — no table or unqualified public.* references,
-- so the bare ALTER cannot break resolution.

alter function private.case_number_base(text) set search_path = '';

-- ══════════════════════════════════════════════════════════════════════════
-- 4) client_errors_ins: bind reporter_id to the caller (or NULL)
-- ══════════════════════════════════════════════════════════════════════════
-- The reporter (src/lib/errorReport.ts) inserts message/stack/route/user_agent
-- only; reporter_id fills from its column default auth.uid(), which satisfies
-- the first disjunct. NULL stays legal (explicitly-anonymous report; also the
-- column's ON DELETE SET NULL end-state). What dies is attributing an error
-- row to ANOTHER member.

drop policy client_errors_ins on public.client_errors;
create policy client_errors_ins on public.client_errors
  as permissive for insert to authenticated
  with check ((reporter_id = (select auth.uid())) or (reporter_id is null));

-- ══════════════════════════════════════════════════════════════════════════
-- 5) 67 FK covering indexes (advisor: unindexed foreign keys)
-- ══════════════════════════════════════════════════════════════════════════

create index if not exists account_links_confirmed_by_idx on public.account_links (confirmed_by);
create index if not exists account_links_created_by_idx on public.account_links (created_by);
create index if not exists accounts_created_by_idx on public.accounts (created_by);
create index if not exists case_assignments_added_by_idx on public.case_assignments (added_by);
create index if not exists case_assignments_removed_by_idx on public.case_assignments (removed_by);
create index if not exists cases_archived_by_idx on public.cases (archived_by);
create index if not exists cases_joint_case_created_by_idx on public.cases (joint_case_created_by);
create index if not exists cases_joint_case_ended_by_idx on public.cases (joint_case_ended_by);
create index if not exists client_errors_reporter_id_idx on public.client_errors (reporter_id);
create index if not exists document_suggestions_decided_by_idx on public.document_suggestions (decided_by);
create index if not exists feedback_meta_updated_by_idx on public.feedback_meta (updated_by);
create index if not exists gang_members_created_by_idx on public.gang_members (created_by);
create index if not exists gang_members_reviewed_by_idx on public.gang_members (reviewed_by);
create index if not exists justice_membership_request_history_actor_id_idx on public.justice_membership_request_history (actor_id);
create index if not exists justice_membership_request_history_request_id_idx on public.justice_membership_request_history (request_id);
create index if not exists justice_membership_requests_decided_by_idx on public.justice_membership_requests (decided_by);
create index if not exists justice_memberships_approved_by_idx on public.justice_memberships (approved_by);
create index if not exists legal_holds_lifted_by_idx on public.legal_holds (lifted_by);
create index if not exists legal_holds_placed_by_idx on public.legal_holds (placed_by);
create index if not exists legal_request_actions_actor_id_idx on public.legal_request_actions (actor_id);
create index if not exists legal_request_actions_version_id_idx on public.legal_request_actions (version_id);
create index if not exists legal_request_exhibits_added_by_idx on public.legal_request_exhibits (added_by);
create index if not exists legal_request_exhibits_version_id_idx on public.legal_request_exhibits (version_id);
create index if not exists legal_request_participants_added_by_idx on public.legal_request_participants (added_by);
create index if not exists legal_request_participants_removed_by_idx on public.legal_request_participants (removed_by);
create index if not exists legal_request_signatures_legal_request_id_idx on public.legal_request_signatures (legal_request_id);
create index if not exists legal_request_signatures_signer_id_idx on public.legal_request_signatures (signer_id);
create index if not exists legal_request_signatures_version_id_idx on public.legal_request_signatures (version_id);
create index if not exists legal_request_versions_created_by_idx on public.legal_request_versions (created_by);
create index if not exists legal_requests_cid_reviewed_by_idx on public.legal_requests (cid_reviewed_by);
create index if not exists legal_requests_closed_by_idx on public.legal_requests (closed_by);
create index if not exists legal_requests_current_version_id_idx on public.legal_requests (current_version_id);
create index if not exists legal_requests_decided_by_idx on public.legal_requests (decided_by);
create index if not exists legal_requests_executed_by_idx on public.legal_requests (executed_by);
create index if not exists legal_requests_imported_by_idx on public.legal_requests (imported_by);
create index if not exists legal_requests_issued_by_idx on public.legal_requests (issued_by);
create index if not exists legal_requests_person_id_idx on public.legal_requests (person_id);
create index if not exists legal_requests_return_filed_by_idx on public.legal_requests (return_filed_by);
create index if not exists legal_requests_return_report_id_idx on public.legal_requests (return_report_id);
create index if not exists legal_requests_revoked_by_idx on public.legal_requests (revoked_by);
create index if not exists legal_requests_served_by_idx on public.legal_requests (served_by);
create index if not exists legal_requests_source_report_id_idx on public.legal_requests (source_report_id);
create index if not exists legal_requests_source_submitter_id_idx on public.legal_requests (source_submitter_id);
create index if not exists legal_seized_items_added_by_idx on public.legal_seized_items (added_by);
create index if not exists legal_seized_items_evidence_id_idx on public.legal_seized_items (evidence_id);
create index if not exists legal_seized_items_media_id_idx on public.legal_seized_items (media_id);
create index if not exists legal_seized_items_person_id_idx on public.legal_seized_items (person_id);
create index if not exists legal_seized_items_removed_by_idx on public.legal_seized_items (removed_by);
create index if not exists legal_seized_items_report_id_idx on public.legal_seized_items (report_id);
create index if not exists legal_seized_items_vehicle_id_idx on public.legal_seized_items (vehicle_id);
create index if not exists mdt_exports_cleared_by_idx on public.mdt_exports (cleared_by);
create index if not exists mdt_exports_exported_by_idx on public.mdt_exports (exported_by);
create index if not exists mdt_exports_proposed_by_idx on public.mdt_exports (proposed_by);
create index if not exists mdt_exports_source_case_id_idx on public.mdt_exports (source_case_id);
create index if not exists mdt_wanted_projections_person_id_idx on public.mdt_wanted_projections (person_id);
create index if not exists membership_request_history_actor_id_idx on public.membership_request_history (actor_id);
create index if not exists membership_request_history_request_id_idx on public.membership_request_history (request_id);
create index if not exists membership_requests_decided_by_idx on public.membership_requests (decided_by);
create index if not exists profiles_login_denied_by_idx on public.profiles (login_denied_by);
create index if not exists prosecutor_bureau_assignments_assigned_by_idx on public.prosecutor_bureau_assignments (assigned_by);
create index if not exists report_versions_created_by_idx on public.report_versions (created_by);
create index if not exists restricted_access_grants_decided_by_idx on public.restricted_access_grants (decided_by);
create index if not exists restricted_access_grants_revoked_by_idx on public.restricted_access_grants (revoked_by);
create index if not exists restricted_access_grants_user_id_idx on public.restricted_access_grants (user_id);
create index if not exists role_events_actor_id_idx on public.role_events (actor_id);
create index if not exists role_events_target_id_idx on public.role_events (target_id);
create index if not exists security_test_runs_created_by_idx on public.security_test_runs (created_by);
