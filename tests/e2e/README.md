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
  changes** (BCB / Senior Detective) from a second browser context, fully
  in the UI. Teardown deactivates the disposable fixture via
  `assign_member` and purges the request via `rls_test_cleanup()` —
  mirroring the RLS suite's approval block. (This spec's first live run
  caught a real 42501 projection bug in the Gate form — `select('*')` vs
  the `internal_decision_note` column revoke — since fixed via explicit
  `MR_COLS` in `MembershipRequest.tsx`.)
