# RLS / RPC security-wall tests

Integration tests that hit the **live Supabase project** as several dedicated,
low-privilege test accounts and assert that the security wall holds:

| Account | State | Used to prove |
| --- | --- | --- |
| `rls-test-lsb@cidportal.test` | detective, LSB, active | baseline member behavior |
| `rls-test-bcb@cidportal.test` | detective, BCB, active | bureau isolation (read/write/create) |
| `rls-test-inactive@cidportal.test` | inactive | deny-by-default |
| `rls-test-owner@cidportal.test` | detective, SAB, active, **is_owner** | owner-POSITIVE paths (triage writes, audit reads) |
| `rls-test-lead@cidportal.test` | **bureau_lead**, LSB, active | Command Center: bureau-lead scoping (own bureau only, no over-promotion) |
| `rls-test-director@cidportal.test` | **director**, SAB, active | Command Center: director keeps broad promote/transfer power |
| `rls-test-target@cidportal.test` | detective, LSB, active | throwaway target the scoping tests promote/transfer and restore |
| `rls-test-applicant@cidportal.test` | detective, LSB, **inactive** | disposable applicant for the membership approval-success path (activated by the test, deactivated + purged in teardown) |

Covered: bureau isolation (read, update, insert, child rows), deny-by-default
for inactive accounts, the sign-off/finalize **lockdown triggers**, RPC caller
checks (`signoff_decide` as non-assignee), owner gates (`feedback_meta`,
`audit_log`), `is_owner` self-grant immunity, the `profiles.email`
column-grant, anonymous access, and the Command Center's `assign_member` bureau-lead scoping (own-bureau-only, no over-promotion; director stays broad).

Newer server surface (2026-07-13 migrations):

- **Membership requests** — `rls-test-inactive` plays the applicant: single
  draft per applicant (unique), LSB/BCB/SAB-only bureau CHECK, the
  `internal_decision_note` column revoke, trigger-frozen workflow columns,
  self-review rejection, detective denial of `admin_membership_requests()`,
  bureau-lead approve scoping (wrong bureau / command role), and the
  correction → resubmit → **reject** review flow (applicant stays inactive).
  `membership_request_submit()` suppresses its command fan-out for rls-test
  applicants (migration `20260713080000`), so submitting never pings real
  officers. `rls_test_cleanup()` purges the request (+history) in `afterAll`
  (migration `20260713070000`), so re-runs start fresh; if a crashed run left
  the row in a terminal status, the status-dependent tests self-skip — a
  clean re-run (or any `rls_test_cleanup` call as the applicant) clears it,
  no SQL-console step needed.
- **Membership approval (success path)** — the disposable
  `rls-test-applicant` account (never the shared inactive fixture) drafts,
  submits, and gets `approve_with_changes`d into BCB/senior_detective by the
  director (or owner): the block asserts the atomic result — decided columns
  + preserved requested values, profile `active/role/division` flipped in the
  same transaction, one `member_approved` notification, `internal_decision_note`
  still revoked, applicant-visible history only. Teardown deactivates the
  applicant via `assign_member` and purges the request via `rls_test_cleanup`
  (which only checks the caller is an rls-test account, not active).
- **Joint cases** — direct `case_assignments` inserts pinned to
  `assignment_source='standard'`, `convert_case_to_joint` caller check,
  bureau stays with the originating bureau (never flips to JTF), case-scoped
  read access for the joint member (case + reports, not other cases),
  immediate revocation on removal, server-enforced `expires_at`, and
  `joint_case_end` history preservation. Fixtures cascade via
  `rls_test_cleanup()`.
- **Announcements** — detectives can neither insert nor publish and are
  denied `announcement_recipient_count`; a bureau lead cannot publish to
  `all`. Broad audiences are proven **without notifying real members**:
  `announcement_recipient_count` (read-only) plus direct inserts — fan-out
  lives only in `publish_announcement`, so a lead's direct `LSB` insert
  (visible in-division, invisible cross-bureau) and a director's direct `all`
  insert create zero notifications. The single `publish_announcement` success
  uses the `specific_members` audience (renamed from `members`, migration
  `20260713060000`) mentioning **only** the two rls-test detectives: exactly
  2 recipients, one deduplicated notification each, visibility via the
  mentions clause. Created announcements carry a `[rls-test]` title marker
  and are deleted by their author in `afterAll`.

## Running

```bash
npm run test:rls
```

Credentials come from the environment (or a git-ignored `.env.rls.local`):

```
RLS_TEST_PASSWORD_LSB=…
RLS_TEST_PASSWORD_BCB=…
RLS_TEST_PASSWORD_INACTIVE=…
RLS_TEST_PASSWORD_OWNER=…   # optional — enables the owner-positive block
RLS_TEST_PASSWORD_LEAD=…    # optional — enables the Command Center scoping block
RLS_TEST_PASSWORD_DIRECTOR=…
RLS_TEST_PASSWORD_TARGET=…
RLS_TEST_PASSWORD_APPLICANT=… # optional — enables the approval-success block
# optional overrides: RLS_TEST_SUPABASE_URL, RLS_TEST_ANON_KEY
```

Without them the whole suite **skips**, so plain `npm test` stays offline.
CI's `security-suites` job runs this suite (and the E2E smoke) whenever the
passwords exist as repository secrets — add them under Settings → Secrets →
Actions to turn it on; forks and secretless clones stay green.

## Safety design

- The accounts sign in with the **anon key + password grant**; none holds a
  command role (the owner account carries only `is_owner`). Passwords live
  only in env/secret storage — rotate them any time in the Supabase
  dashboard (Auth → Users).
- The core suite asserts **denials**; the separate owner block asserts the
  owner's positive paths (triage metadata, audit reads). Neither drives the
  real sign-off chain, so tests can't route work or notifications to real
  officers. The owner account holds no command role — its blast radius is
  feedback triage + audit reads.
- Fixtures (one case + one report + one feedback row per run) are removed in
  `afterAll` by the `rls_test_cleanup()` RPC (migration `rls_test_cleanup_rpc`),
  which only the `rls-test-*` accounts may call and which deletes **only rows
  they authored**.
- The active accounts are visible in the roster as "RLS Test — …". If they
  bother you, deactivate them; the suite then fails its sanity check instead
  of silently passing.

## Track record

First run immediately caught a live bug: `private.is_owner()` was missing its
EXECUTE grant, which made **every** statement touching an `is_owner`-based
policy fail for all users — member feedback submission, the owner's triage
writes, and the owner's audit view. Fixed by migration
`grant_execute_is_owner` (2026-07-09).
