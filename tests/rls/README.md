# RLS / RPC security-wall tests

Integration tests that hit the **live Supabase project** as several dedicated,
low-privilege test accounts and assert that the security wall holds:

> **Fixture accounts are not currently provisioned.** The
> `rls-test-*@cidportal.test` accounts were removed from the live project on
> 2026-08-25 (owner request, alongside the bureau restructure). Re-provision
> the roster below (matching the divisions it lists) before running this
> suite; `owner_security_overview()` reports the expected fixture state.

> **These run against PRODUCTION.** That is safe only while every write stays
> inside the `rls-test-*@cidportal.test` namespace. Before adding a test:
>
> - never `.delete()` without an `.eq` / `.in` / `.match` filter;
> - never `TRUNCATE`, and never touch a case, report, member or record your
>   fixture did not create;
> - if your test needs a case, **create one** — do not borrow a real one;
> - anything attached to a real CID record will survive `rls_test_cleanup()`
>   and become live data. An `audience='cid'` SIU disclosure, for instance, is
>   visible division-wide.
>
> `rls_test_cleanup()` is `SECURITY DEFINER` and bypasses RLS, so it is
> confined to the fixture namespace by construction (migration
> `20260827120000`): it deletes only what a fixture owns *and* whose removal
> cannot alter someone else's record. Anything you author outside that
> namespace is **reported, not cleaned** — and fails the run post-suite. You
> will have to remove it by hand. See
> [`docs/TEST-ENVIRONMENT.md`](../../docs/TEST-ENVIRONMENT.md#safety-review-of-the-rls-suites-2026-08-17)
> before extending cleanup.

| Account | State | Used to prove |
| --- | --- | --- |
| `rls-test-lsb@cidportal.test` | detective, major_crimes, active | baseline member behavior |
| `rls-test-bcb@cidportal.test` | detective, street_crimes, active | bureau isolation (read/write/create) |
| `rls-test-inactive@cidportal.test` | inactive | deny-by-default |
| `rls-test-owner@cidportal.test` | detective, major_crimes, active, **is_owner** | owner-POSITIVE paths (triage writes, audit reads) |
| `rls-test-lead@cidportal.test` | **bureau_lead**, major_crimes, active | Command Center: bureau-lead scoping (own bureau only, no over-promotion) |
| `rls-test-director@cidportal.test` | **director**, major_crimes, active | Command Center: director keeps broad promote/transfer power |
| `rls-test-target@cidportal.test` | detective, major_crimes, active | throwaway target the scoping tests promote/transfer and restore |
| `rls-test-applicant@cidportal.test` | detective, major_crimes, **inactive** | disposable applicant for the membership approval-success path (activated by the test, deactivated + purged in teardown) |
| `rls-test-judge / -judge2@cidportal.test` | active **Judge** (`justice_memberships`: judiciary / judge), **no active CID profile** — not provisioned, issue #299 | judicial claim (atomic race), decisions incl. partial approval, the judge return fast lane; judge2 stays unassigned to prove isolation and cannot see a sealed assignment |
| `rls-test-ag@cidportal.test` | active **Attorney General** (`justice_memberships`: doj / attorney_general), no active CID profile — not provisioned, issue #299 | AG oversight of every judge-submitted request (sealed included), `assign_judge` for sealed requests, comment / observer authority, never a decision |
| `rls-test-justice@cidportal.test` | no membership at all | the first-login Gate (CID-only application form) in `tests/e2e/justice.spec.ts` |

Retired with Portal Improvements P4-01 (the prosecutor stage is gone; Judge +
Attorney General are the only justice roles): `rls-test-prosecutor` /
`-prosecutor2` / `-ada-lsb` / `-ada-bcb` / `-ada-sab` / `-da` are **no longer
needed** — suites that still name them (`v121`, `v140`, `v174`) self-skip and
document historical surface. Provisioning contract for the three DOJ fixtures:
[`docs/TEST-ENVIRONMENT.md`](../../docs/TEST-ENVIRONMENT.md#doj-fixture-roster-phase-4)
and the header of `tests/rls/v163.test.ts`.

Covered: bureau isolation (read, update, insert, child rows), deny-by-default
for inactive accounts, the sign-off/finalize **lockdown triggers**, RPC caller
checks (`signoff_decide` as non-assignee), owner gates (`feedback_meta`,
`audit_log`), `is_owner` self-grant immunity, the `profiles.email`
column-grant, anonymous access, and the Command Center's `assign_member` bureau-lead scoping (own-bureau-only, no over-promotion; director stays broad).

Newer server surface (2026-07-13 migrations):

- **Membership requests** — `rls-test-inactive` plays the applicant: single
  draft per applicant (unique), major_crimes/street_crimes-only bureau CHECK, the
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
  submits, and gets `approve_with_changes`d into street_crimes/senior_detective by the
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
  lives only in `publish_announcement`, so a lead's direct `major_crimes` insert
  (visible in-division, invisible cross-bureau) and a director's direct `all`
  insert create zero notifications. The single `publish_announcement` success
  uses the `specific_members` audience (renamed from `members`, migration
  `20260713060000`) mentioning **only** the two rls-test detectives: exactly
  2 recipients, one deduplicated notification each, visibility via the
  mentions clause. Created announcements carry a `[rls-test]` title marker
  and are deleted by their author in `afterAll`.

### Legal workflow, Phase 4 (`tests/rls/v186a` … `v186e`, `v163`, `legal.test.ts`)

Portal Improvements P4-01 … P4-12 (migrations `20261024120000_legal_tables` →
`20261027120000_legal_sweeps`) retired the prosecutor stage: a Bureau Lead
approve lands in `submitted_to_judge`. The CID fixtures alone (lsb / bcb /
lead / owner) prove the CID side; every judicial leg is `it.skipIf(!doj)` on
the judge / AG passwords (issue #299).

- **v186a** (P4-01 / P4-04): a warrant without `standard_of_proof` +
  `pc_statement` is refused; approve → `submitted_to_judge` with
  `submitted_to_judge_at` / `stage_entered_at` stamped and no decision; CID
  actors can neither claim nor assign a judge; `justice_appoint('prosecutor')`
  answers the retired-role message; the prosecutor RPCs are EXECUTE-revoked
  (42501). DOJ legs: judge return → change summary required → fast lane back
  to the judge (material change → CID gate); sealed = AG-assigned only, Owner
  fallback, judge cannot even read it.
- **v186b** (P4-03): `legal_set_charges` replaces the set with statute
  snapshots; another case's charge refused; frozen after submit; bcb reads 0
  rows; no client writes.
- **v186c** (P4-05): creator + approver-pool comments, replies, author-only
  edit with `legal_request_comment_versions`, delete blanks the body, sealed
  `legal_comment` payloads carry `{request_id, sealed:true}` only and the
  author is never paged; no client writes.
- **v186d** (P4-07): `legal_request_target_decisions` RPC-only and hidden
  from bcb; DOJ: all-denied refused, one denied target → `partially_approved`
  with rows + `_target_decisions` frozen into the judicial version +
  defaulted expiry; the creator issues; withdraw refused.
- **v186e** (P4-10): `legal_sweep_run()` Owner-only, jsonb counts, an
  immediate second run reports 0 new reminders; `legal_request_reminders` no
  client write; `legal_expiry_defaults` readable (arrest 30 / search 14 /
  subpoenas 14) and not writable; `stage_entered_at` trigger-maintained.
- **v163** is now the judge-only walkthrough (two judges + AG): atomic claim
  race, assigned-judge-only decision, judge / AG never issue, no direct
  writes, AG assigns and never decides, deactivation requeues, sealed never on
  the bench, prosecutor RPCs revoked for justice users, packet isolation.
  **v165** keeps stages / evidence designation / case brief and only the
  `justice_set_coverage` refusal. **legal.test.ts** asserts the queue hand-off
  and runs its fulfilment chains behind the judge fixture.

### DOJ legal review (v1.13.0 — `tests/rls/legal.test.ts`; historical model)

37 assertions covering the DOJ Legal Review System (see
`docs/DOJ-INTEGRATION.md`): justice identity separation (CID/DOJ/Judge never
cross domains; hidden-field role smuggling rejected), the onboarding approval
matrix, ADA bureau assignments (one primary/acting per bureau, no Judge/JTF,
no self-assign), routing precedence (acting → primary; missing coverage parks
unassigned, never reroutes; DA/AG/Owner override needs a reason), drafting +
immutable versions, CID review, ADA review + **packet isolation** (an assigned
ADA sees the request and its packet but not the case, evidence, or roster),
conflict-of-role (prosecutor ≠ Judge on the same request), the DA and AG
subpoena approval routes, judicial approval signing the exact version, CID-side
fulfilment + the MDT expired-vs-wanted contract, sealed-request undiscoverability
(table/search/notifications), and hard-delete resistance. The suite purges
leftovers via `rls_test_cleanup()` at **both** start and teardown, so re-runs
are deterministic; a NULL-guard gap it caught became migration
`20260714070000_legal_null_guards`.

**Run-level cleanup guard (no production pollution).** Beyond each suite's own
`afterAll`, a vitest `globalSetup` (`tests/rls/globalSetup.ts`) calls
`rls_test_cleanup()` once **before** any suite starts and once **after** the
whole run finishes. An `afterAll` is skipped when a file throws in `beforeAll`
or times out — which is how test rows accumulated in the live project (24 SOP
docs / 4 narcotics / 1 place, removed by hand 2026-07-18). The run-level hook
plus the widened `rls_test_cleanup` (migration `20260807160000`, which now also
purges fixture-authored documents / narcotics / gangs / places / vehicles /
persons) means a crash can no longer leak into production. `v144` is the
regression pin.

The justice fixture passwords (`RLS_TEST_PASSWORD_JUDGE / _JUDGE2 / _AG`,
`_JUSTICE` for the Gate spec) enable the DOJ legs; without them they skip. `tests/rls/auth.ts` adds a sign-in backoff so
authenticating ~20 fixtures per run doesn't trip GoTrue's per-IP burst limit.

### Security dashboard reporter (v1.14 — `tests/rls/securityReporter.ts`)

A vitest reporter (registered in `vitest.rls.config.ts`) feeds the Owner
Portal's **Security Testing** section after every run: it signs in as the
`rls-test-lsb` fixture (anon key + password grant — the same credentials the
suite itself used) and posts per-file pass/fail/skip counts plus **sanitized**
failure summaries (test name + first assertion line only) through the
`security_test_report()` RPC, which is EXECUTE-limited to `rls-test-*`
accounts and re-sanitizes server-side. Reporting is strictly **best-effort**:
any error logs a warning and never affects the run, and it self-skips when the
anon key or `RLS_TEST_PASSWORD_LSB` is absent — so plain/secretless runs stay
offline. In CI it reports automatically (as `source: 'ci'`) whenever the
fixture-password secrets exist. No service key, no new secrets.

A `tests/rls/v114.test.ts` suite covers the v1.14 surface (report-version
immutability, `search_all` legal hits staying sealed-safe, and the
security-testing RPC gates).

### DOJ search warrants & owner import (v1.15 — `tests/rls/v115.test.ts`)

A `tests/rls/v115.test.ts` suite covers the v1.15 legal surface: the new
`search_warrant` behaviors (accepted as a warrant subtype; a subject **or** at
least one `form_data.search_targets` entry required — no mandatory
Persons-registry suspect; Judge-only approval inherited; classified default; no
MDT wanted-person projection), and the owner-only warrant import
(`import_legal_warrant` restricted to the owner and denied to non-owners;
**idempotency** on `import_key` — a repeat key yields no duplicate; provenance
columns recording the historical submitter/timestamp separately from the import
actor; landing at `submitted_to_doj`; and `import_rollback_by_key` reversal that
leaves `audit_log` intact). The suite has **not** been run yet — it documents
the intended coverage.

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
RLS_TEST_PASSWORD_JUDGE=…     # optional — DOJ legs (judge); not provisioned, issue #299
RLS_TEST_PASSWORD_JUDGE2=…    # optional — the second judge (v163 race)
RLS_TEST_PASSWORD_AG=…        # optional — the Attorney General
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
