# E2E smoke tests (Playwright)

Drives the real app in a real browser: the signed-out gate, a programmatic
sign-in as the LSB test account, the shell, and creating a case through the
actual UI. Uses the same accounts, credentials, and cleanup RPC as the RLS
suite — read [`../rls/README.md`](../rls/README.md) first.

```bash
npm run build      # the server under test is `next start`
npm run test:e2e   # skips entirely without RLS_TEST_PASSWORD_LSB
```

Notes:

- The app's UI is OAuth-only; the test mints a session via the GoTrue
  **password grant** and seeds it into supabase-js's localStorage key, which
  is exactly the state the app is in after an OAuth redirect.
- `PW_CHROMIUM_PATH=/path/to/chrome` points the runner at a preinstalled
  Chromium instead of a version-pinned download.
- `PW_SUPABASE_SHIM=1` relays the browser's Supabase HTTP calls through
  Node — needed only in sandboxes whose egress proxy Chromium cannot
  traverse. Realtime websockets stay unshimmed; the smoke flow doesn't
  depend on them.
- Fixtures are removed after each run via `rls_test_cleanup()`.

## v1.11 feature coverage (`features-joint-announce.spec.ts`)

Runs against the **live project** with the same `rls-test-*` fixture
accounts as smoke/RLS (`RLS_TEST_SUPABASE_URL` / `RLS_TEST_ANON_KEY` /
`RLS_TEST_PASSWORD_*`; sign-in helper factored into `liveAuth.ts`).
Self-skips without those secrets; each spec additionally skips when its
specific account password is absent.

- **Announcements** (director): full audience menu incl. Everyone, the
  `@everyone` chip + recipient-count preview — then **cancels** at the
  confirm step. The only real publish targets **Specific Members**,
  mentioning only the RLS test detective (fan-out = 1 test account);
  asserts the card + "Specific members" chip and deletes via the author
  path. A `page.route` guard hard-aborts any `publish_announcement` whose
  audience isn't `specific_members`, and `discord-announce` is stubbed.
- **Announcement authority** (bureau lead): Everyone is not offered; My
  Department is; body `"@everyone"` warns instead of retargeting. Never
  publishes.
- **Joint cases** (bureau lead): create → convert with the
  cross-department RLS Test BCB member (keyboard `listbox` picker), JTF
  badge, Overview joint-members panel, removal with a reason (removal
  history), end joint-case status. Cleanup via `rls_test_cleanup()`.
- **Approval queue** (director): the "Pending membership requests" section
  contract (heading + empty state OR rows — the live queue may hold real
  requests; never asserts specific rows).
- **Applicant flow**: the inactive `rls-test-applicant` lands on the Gate
  (UI-asserted: no shell, no Command Center) and submits a membership
  request through the real Gate form; a director approves it **with
  changes** (Street Crimes / Senior Detective) from a second browser context, fully
  in the UI. Teardown deactivates the disposable fixture via
  `assign_member` and purges the request via `rls_test_cleanup()` —
  mirroring the RLS suite's approval block. (This spec's first live run
  caught a real 42501 projection bug in the Gate form — `select('*')` vs
  the `internal_decision_note` column revoke — since fixed via explicit
  `MR_COLS` in `MembershipRequest.tsx`.)

## Report builder (`reports.spec.ts`, Phase 5)

Runs against the **live project** with the lsb + lead fixtures
(`reportFixtures.ts` builds one `[rls-test]` case per run, reads the
published template catalog the Reports tab renders from, and sweeps via
`rls_test_cleanup()` — with the same crash-safety teardown as the legal
fixtures). Self-skips without `RLS_TEST_PASSWORD_LSB` / `_LEAD`.

- **Catalog → drafts**: every active published template is offered and a
  draft is created from each through the editor (`Save` → "Report saved.").
- **Required-field gate + submit**: an empty `incident_followup` refuses
  "Submit for review" with the server's `required fields missing` message;
  the required keys are read from the published version (never
  hard-coded), filled, and the submit lands in **Awaiting review** — the
  author loses Edit / Submit.
- **Review**: the Bureau Lead sees **Approve** / **Return for revision**,
  approves with a typed signature, and the report shows **Sealed**.

Selectors follow the Phase 5 `ReportsTab` (labels from
`REPORT_REVIEW_LABEL`); the assertions are the contract, the markup is not.

## Intel triage (`intel.spec.ts`, Phase 6)

Runs against the **live project** with the lsb + lead fixtures (one
`[rls-test]` record with an undecided person claim per run, built inline
through the same REST path the RLS suite uses, swept by `rls_test_cleanup()`
with the crash-safety teardown) and, when `RLS_TEST_PASSWORD_FIELD` is set,
the optional field-officer fixture (its own record, deleted by the lead).
Self-skips without `RLS_TEST_PASSWORD_LSB` / `_LEAD`; the officer leg
`test.skip`s on its own.

- **Reject → Rejected / Restore**: the reviewer's **Reject** (reason
  prompt) shows **Rejected**; a detective is not offered **Restore**; the
  Bureau Lead is, and restoring clears the rejection (verified through the
  API too).
- **Closed, never the reason** (officer fixture): the officer's **My
  Reports** lists the rejected record as **Closed**; neither the list nor
  the receipt renders "Rejected" or the reason text.
- **One composer, two audiences**: **Private note to reviewers** (default)
  posts a note that the officer thread never carries (asserted on the
  `field_submission_messages` / `field_submission_reviews` tables as well);
  **Message the officer** posts to the thread with `from_reviewer`.
- **Validate gate**: **Validate** (note prompt) on a record with an
  undecided claim surfaces the server's `validate every claim and grade the
  source first`; `validated_at` stays null.

Selectors follow the contract's labels (Reject, Restore, Validate, "Private
note to reviewers", "Message the officer", "Closed", "Rejected") and the
`/tools?tool=field-review&record=<id>` deep link; where the Phase 6 review
screen names a control differently, update the selector — the assertions
are the contract, the markup is not.
