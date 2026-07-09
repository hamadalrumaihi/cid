# RLS / RPC security-wall tests

Integration tests that hit the **live Supabase project** as three dedicated,
low-privilege test accounts and assert that the security wall holds:

| Account | State | Used to prove |
| --- | --- | --- |
| `rls-test-lsb@cidportal.test` | detective, LSB, active | baseline member behavior |
| `rls-test-bcb@cidportal.test` | detective, BCB, active | bureau isolation (read/write/create) |
| `rls-test-inactive@cidportal.test` | inactive | deny-by-default |

Covered: bureau isolation (read, update, insert, child rows), deny-by-default
for inactive accounts, the sign-off/finalize **lockdown triggers**, RPC caller
checks (`signoff_decide` as non-assignee), owner gates (`feedback_meta`,
`audit_log`), `is_owner` self-grant immunity, the `profiles.email`
column-grant, and anonymous access.

## Running

```bash
npm run test:rls
```

Credentials come from the environment (or a git-ignored `.env.rls.local`):

```
RLS_TEST_PASSWORD_LSB=…
RLS_TEST_PASSWORD_BCB=…
RLS_TEST_PASSWORD_INACTIVE=…
# optional overrides: RLS_TEST_SUPABASE_URL, RLS_TEST_ANON_KEY
```

Without them the whole suite **skips** (so plain `npm test` and CI stay
offline). To run it in CI, add the three passwords as repository secrets and
export them in the workflow step — deliberately not wired up by default.

## Safety design

- The accounts sign in with the **anon key + password grant**; they hold no
  command role and no `is_owner`. Their passwords live only in env/secret
  storage — rotate them any time in the Supabase dashboard (Auth → Users).
- Every assertion is a **denial**; the suite never drives the real sign-off
  chain, so it can't route work or notifications to real officers.
- Fixtures (one case + one report + one feedback row per run) are removed in
  `afterAll` by the `rls_test_cleanup()` RPC (migration `rls_test_cleanup_rpc`),
  which only the `rls-test-*` accounts may call and which deletes **only rows
  they authored**.
- The two active accounts are visible in the roster as "RLS Test — …". If they
  bother you, deactivate them; the suite then fails its sanity check instead
  of silently passing.

## Track record

First run immediately caught a live bug: `private.is_owner()` was missing its
EXECUTE grant, which made **every** statement touching an `is_owner`-based
policy fail for all users — member feedback submission, the owner's triage
writes, and the owner's audit view. Fixed by migration
`grant_execute_is_owner` (2026-07-09).
