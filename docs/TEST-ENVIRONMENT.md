# Test Environment — dedicated Supabase project

Automated **functional E2E** and **visual regression** run against a small,
permanent, **non-production** Supabase project seeded with synthetic data and
six role accounts. Production is never touched: the app under test is built
against `TEST_SUPABASE_*`, and the seed wrapper hard-blocks the production
project ref. External side effects are impossible (no FiveManage key → uploads
fall back to paste-URL; no Discord function deployed → no DMs; email
confirmations off → no emails).

Decisions in force: **Supabase Free tier**, **schema kept in sync by rebuilding
from `supabase/schema-snapshot.sql`**, **you provision the project + secrets, I
wired the scripts/CI**, **functional + visual from the start**.

---

## Architecture

```
GitHub Actions (.github/workflows/test-e2e-visual.yml, self-skips w/o secrets)
  1. npm ci
  2. node scripts/test-seed.mjs      → reset + seed the TEST project (psql)
  3. playwright install chromium
  4. npm run build                    → app built against TEST_SUPABASE_*
  5. npm run test:e2e                 → tests/e2e/roles.spec.ts (role nav)
  6. npm run test:visual              → tests/visual/*  (screenshots vs baselines)
        │ TEST_* secrets only (never prod)
        ▼
  DEDICATED test Supabase project (Free)  — synthetic data, 6 role accounts
```

- **Accounts** (`tests/support/accounts.json`): detective, senior, lead,
  deputy, director, owner — on `@cidportal.test`.
- **Sign-in** (`tests/support/signin.ts`): GoTrue password grant → session
  injected into supabase-js localStorage, exactly like an OAuth redirect.
- **Guards:** `signin.ts` throws if `TEST_SUPABASE_URL` is the prod host;
  `scripts/test-seed.mjs` exits if `TEST_DATABASE_URL` contains the prod ref.

---

## One-time setup (you do this)

1. **Create the project** — Supabase → New project (Free). Name e.g. `cid-test`.
   Note its **Project URL**, **anon/publishable key**, and **service DB
   connection string** (Settings → Database → Connection string → URI).
2. **Turn off email confirmation** — Authentication → Providers → Email →
   disable "Confirm email" (tests use the password grant; no mail is sent).
3. **Do NOT deploy** the `discord-notify` Edge Function to this project, and do
   **not** set a FiveManage key. (Absence = no external side effects.)
4. **Build the schema** — apply the current production snapshot to the empty
   project (this is the "rebuild from snapshot" that keeps test == prod):
   ```bash
   psql "$TEST_DATABASE_URL" -f supabase/schema-snapshot.sql
   ```
5. **Add GitHub Actions secrets** (Settings → Secrets and variables → Actions):
   | Secret | Value |
   |---|---|
   | `TEST_SUPABASE_URL` | test project URL |
   | `TEST_SUPABASE_ANON_KEY` | test anon/publishable key |
   | `TEST_DATABASE_URL` | test project Postgres URI (seed only) |
   | `TEST_PW_DETECTIVE` … `TEST_PW_OWNER` | six strong passwords you choose |
6. **Seed + generate baselines** (locally, once) — with the same values in a
   local `.env.rls.local` (git-ignored):
   ```bash
   npm run test:seed              # creates the 6 accounts + fixture
   npm run build
   npm run test:visual:update     # writes tests/visual/__screenshots__/*
   git add tests/visual/__screenshots__ && git commit  # baselines are code
   ```
   After baselines are committed and the CI job is green, remove
   `continue-on-error` from the `e2e-visual` job to make it a required gate.

Nothing above puts a password or key in the repo — only in Supabase and in
encrypted GitHub secrets.

---

## Everyday use

- **Reset the data** (safe to run any time; idempotent): `npm run test:seed`.
- **Run functional tests:** `npm run build && npm run test:e2e`.
- **Run visual tests:** `npm run test:visual` (add `:update` to refresh
  baselines after an intentional UI change, then commit the new PNGs).
- CI runs all of the above automatically on every PR once the secrets exist.

---

## Keeping schema in sync (drift prevention)

`check:schema` already fails the main CI if `supabase/schema-snapshot.sql`
disagrees with the types generated from **production**, so the snapshot is
always current-with-prod. Therefore, **after any production migration**, refresh
the test project's schema by re-applying the snapshot:

```bash
psql "$TEST_DATABASE_URL" -f supabase/schema-snapshot.sql
```

Because the snapshot == prod (guaranteed by `check:schema`), the test project's
structure then == prod. If the snapshot isn't drop-safe for a live re-apply,
recreate the `public` schema first (see Recovery).

---

## Maintenance & recovery

- **Project paused (Free tier auto-pauses after ~7 days idle):** open it once in
  the Supabase dashboard (or hit any endpoint) to resume, then re-run CI. If
  pauses become disruptive, upgrade this one project to Pro ($25/mo).
- **Rebuild from scratch:** in the SQL editor run
  `drop schema public cascade; create schema public;` then
  `psql "$TEST_DATABASE_URL" -f supabase/schema-snapshot.sql`, then
  `npm run test:seed`.
- **Rotate passwords:** change the `TEST_PW_*` secrets and re-run
  `npm run test:seed` (it refreshes the stored hashes).
- **Lost the project:** repeat One-time setup; nothing here is irreplaceable.

---

## Guarantees

- Production is never a target (two independent guards).
- Synthetic data only; deterministic and resettable.
- No emails, DMs, uploads, or third-party calls from the test env.
- No secrets committed; the suite self-skips without them, so forks stay green.
