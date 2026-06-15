# Odyssey CID Portal — Supabase backend

Migration of the single-file CID Portal (kept at `/legacy`) into a multi-user
Next.js + Supabase app. **Postgres-only** (no Google Drive); images live in
Supabase Storage gated by the same RLS rules as the data.

> Target project: **`sahp-rbac`** (`nuujdewnkovtdvlbfzdx`). Status: review pending —
> migrations below are authored but **not yet applied** (awaiting explicit
> authorization to resume the paused project and apply).

## RBAC model
Two axes enforced in the database via RLS:

- **Rank** — `director`, `deputy_director`, `lead_detective`, `detective`, `analyst`
- **Bureau** — `LSB`, `BCB`, `SAB`, `JTF`

Key rules:
- **Deny-by-default:** new Discord sign-ins land as `analyst` / `JTF` with
  `active=false` → they see only their own profile and **no data** until a
  command user assigns rank/bureau and sets `active=true`.
- **Command = Director + Deputy + Bureau Lead.** Director/Deputy are global;
  Lead Detective is command **within their own bureau** (and on global
  gang/location resources). Command gates: ticket routing, tracker co-sign,
  RICO export, gang/location create-edit-delete, JTF media promotion.
- **Bureau-scoped data:** cases, case_reports, trackers, raid_compensations,
  case-linked media. Detective sees own bureau (+ `view_all` override); JTF and
  command see all.
- **Global/shared data:** gangs, gang_ranks/members/turf, narcotics, locations,
  ballistics — readable by any active member; create/edit/delete = command.
- **Media JTF rule:** case-linked media defaults to the case's bureau; promoting
  it to `JTF` (all-visible) requires command.

All `security definer` functions pin `set search_path = ''` and schema-qualify
references.

## Migrations
1. `…_init_schema_rls.sql` — enums, profiles, helpers, all tables, RLS, triggers.
2. `…_storage.sql` — `evidence` / `mugshots` / `backups` buckets + path-encoded
   bureau RLS (`{BUREAU}/{entity}/{uuid.ext}`).
3. `…_seed_catalogs.sql` — report templates, RICO predicate catalog, narcotics
   registry, demo gangs/benches, and `bootstrap_director()`.

## Apply order (once authorized + credentials wired via MCP/env)
1. Resume the project (it is free-tier paused).
2. Apply migrations 1 → 2 → 3.
3. Configure the **Discord auth provider** (client id + secret via env/MCP, never
   in chat). Redirect URL: `https://nuujdewnkovtdvlbfzdx.supabase.co/auth/v1/callback`.
4. Sign in once with Discord, then run `select public.bootstrap_director('<your_discord_id>');`
5. Use the in-app admin UI to assign a **second command user** (no single point of failure).

## Data migration from the legacy app
Existing data lives in the old app's `localStorage` (browser-side), so it can't be
read server-side. The Next.js app will ship a **command-only importer**: export
JSON from the legacy app (key `cid-portal-v3`) → upload → upsert into the new
tables (cases, gangs, drugs, benches, ballistic signatures, personnel,
commendations, media, M.O. profiles, CIs, trackers).

## Backups (free-tier — no automatic backups)
- Command-only **Export JSON** (full relational dump) + restore importer.
- Optional weekly Vercel Cron snapshot → private `backups` bucket.
- `supabase db dump` for full SQL backups.

## RLS test matrix (before trusting policies)
Seed one throwaway user per **rank × bureau (20 combos)** and assert **both**
allow and **deny** paths — e.g. a Detective in BCB must get **empty** results for
LSB cases (a policy that passes its own bureau but fails to block others looks
identical to a correct one until the breach is checked).
