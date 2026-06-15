# CID Records (Live) — setup

Adds a shared, two-way records system to the static site, backed by Supabase.
The live data lives in Postgres (never committed to the repo).

- **Migration:** `supabase/migrations/20260615130000_cid_records.sql`
- **Frontend:** integrated into `index.html` (new **CID Records** tab), using
  `@supabase/supabase-js@2` from CDN.
- **Project:** `sahp-rbac` (`nuujdewnkovtdvlbfzdx`) — URL already wired in.

## What you must set (one value)
In `index.html`, find the `window.CID_SUPABASE` block and replace the key:

```js
window.CID_SUPABASE = {
  url: 'https://nuujdewnkovtdvlbfzdx.supabase.co',   // already set
  anonKey: 'PASTE_YOUR_ANON_OR_PUBLISHABLE_KEY_HERE'  // <-- paste here
};
```

- Use the **anon / publishable** key only. It is public by design — safe to
  commit and ship in the static site. **Never** put the `service_role` key here.
- Get it from: **Dashboard → Project Settings → API → Project API keys → `anon` (or publishable)**.

## Exact Supabase dashboard steps (manual)
1. **Resume the project** if paused: open the project; it auto-resumes (free tier
   pauses on inactivity).
2. **Run the schema:** Dashboard → **SQL Editor** → paste the contents of
   `20260615130000_cid_records.sql` → **Run**. (Creates the table, RLS policies,
   the updated_at trigger, realtime, and 2 seed rows.)
3. **Enable Realtime** (usually on by default): Database → Replication →
   ensure `cid_records` is in the `supabase_realtime` publication (the SQL adds it).
4. **Auth → Providers:**
   - **Email:** enable Email; turn on "Email OTP / magic link". (For zero-friction
     testing you may disable "Confirm email".)
   - **Discord:** create a Discord app at https://discord.com/developers →
     OAuth2 → copy **Client ID** + **Client Secret** → in Supabase enable the
     **Discord** provider and paste them.
5. **Auth → URL Configuration:**
   - **Site URL:** your GitHub Pages URL (e.g. `https://<user>.github.io/<repo>/`).
   - **Redirect URLs:** add the same URL (and `http://localhost...` if testing locally).
   - Discord OAuth callback (set in the Discord app's redirect list):
     `https://nuujdewnkovtdvlbfzdx.supabase.co/auth/v1/callback`
6. **Paste the anon key** into `index.html` (above), commit, and push to Pages.

## Behavior
- **On load:** records are fetched and rendered as cards (public read).
- **Realtime:** any insert/update broadcasts to all open clients (re-fetch).
- **Logged-out:** read-only (no New/Edit buttons).
- **Logged-in (Discord or email):** "+ New Record" and per-card "Edit".
- A signed-in user may create records and edit **only the records they created**
  (per RLS — see below).

## RLS summary (in the migrations)
- `select` → `anon, authenticated` (public read so the site shows data on load).
  *To restrict to logged-in users, change that policy's role to `authenticated`.*
- `insert` → `authenticated`, forced to `created_by = auth.uid()` (no spoofing).
- `update` → `authenticated`, only where `auth.uid() = created_by` (owner-only).
- No `delete` policy (deletes blocked) — add one if you want it.

> Owner-scoping comes from `20260615140000_cid_records_owner_update.sql`, which
> supersedes the open policies in `20260615130000_cid_records.sql`. The 2 NULL-owner
> seed rows are therefore not editable via the app; that migration includes a
> commented "owner-or-orphan" variant if you want to allow editing them.

## Fields
`name` (required), `callsign`, `case_number`, `charges`, `status`
(Open/Cold/Closed/Wanted), `officer`, `notes`, `mugshot_url`, `gang`, `bureau`
(LSPD/BCSO/SAHP/JTF), `last_seen`, plus `created_by`, `created_at`, `updated_at`.
