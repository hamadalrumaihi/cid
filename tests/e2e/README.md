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
