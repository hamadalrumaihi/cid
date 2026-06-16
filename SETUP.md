# Odyssey CID Platform — Setup & Deployment

Static front-end (GitHub Pages) + Supabase backend. No custom server, no build step.

> **Status:** Phase 1 (backend) authored & locally validated. Phase 2 (multi-file
> front-end: auth gate, per-module Supabase data layer, Evidence/Case Detail,
> RBAC UI, notifications, analytics) is in progress — see CHANGELOG.

## 0. Prerequisites
- Supabase project **`cid`** (`jhxuflzmqspidkvjckox`). Resume it if paused.
- A Google Cloud project (for Google OAuth) and a Discord application (for Discord OAuth).

## 1. Run the migrations
Dashboard → **SQL Editor** → run, in order:
1. `supabase/migrations/20260616090000_platform.sql` — full platform schema, RBAC
   RLS, triggers, realtime, audit_log.

(The earlier `cid_records` / RBAC-design migrations are superseded by this file
for the platform build; don't run them on the same project.)

This creates 27 tables with RLS (approved-members-only read; create/update for any
active member; **delete restricted to Director + Command**), `updated_at` + audit
triggers, and adds every table to the `supabase_realtime` publication.

## 2. Auth providers
Dashboard → **Authentication → Providers**:

### Google
1. Google Cloud Console → APIs & Services → Credentials → **Create OAuth client ID** (Web).
2. Authorized redirect URI: `https://jhxuflzmqspidkvjckox.supabase.co/auth/v1/callback`
3. Copy **Client ID** + **Client Secret** → paste into Supabase **Google** provider, enable.

### Discord
1. https://discord.com/developers → New Application → **OAuth2**.
2. Redirect: `https://jhxuflzmqspidkvjckox.supabase.co/auth/v1/callback`
3. Copy **Client ID** + **Client Secret** → paste into Supabase **Discord** provider, enable.

### URL configuration
Authentication → **URL Configuration**:
- **Site URL:** your Pages URL, e.g. `https://<user>.github.io/<repo>/`
- **Redirect URLs:** add the Pages URL (and `http://localhost:*` for local testing).

## 3. Front-end config (public anon key only)
In the front-end config block (`window.CID_SUPABASE`):
```js
window.CID_SUPABASE = {
  url: 'https://jhxuflzmqspidkvjckox.supabase.co',   // prewired
  anonKey: 'PASTE_ANON_OR_PUBLISHABLE_KEY'           // Settings → API → anon/publishable
};
```
The anon/publishable key is **public by design** (RLS protects data). **Never** put
the `service_role` key in the client.

## 4. Bootstrap the first Command user
1. Deploy + sign in once with your Google or Discord (creates an **inactive** profile).
2. SQL Editor: `select public.bootstrap_command('your-login-email@example.com');`
3. You're now Command (active). Use the in-app **Personnel/Admin** screen to approve
   and assign other officers (`role`, `division`, `active`) — no SQL needed after this.

## 5. RBAC model
| Role | Read | Create/Edit | Authorize / Finalize | Delete |
|------|------|-------------|----------------------|--------|
| (inactive) | ✗ | ✗ | ✗ | ✗ |
| Detective | ✓ | ✓ | ✗ | ✗ |
| Supervisor | ✓ | ✓ | ✓ | ✗ |
| Director | ✓ | ✓ | ✓ | ✓ |
| Command | ✓ | ✓ | ✓ | ✓ + member admin |

- **Read = approved members only.** New sign-ins see nothing until activated.
- **Delete = Director + Command.**
- Member promotion/activation is Command-only (`public.assign_member` RPC).

## 6. Graceful guard
If `anonKey` is unset or Supabase is unreachable, the app shows a clear setup
notice instead of failing.

## 7. Tables (27)
profiles, cases, case_assignments, persons, evidence, custody_chain (append-only),
gangs, gang_ranks, gang_members, places, place_process_steps, narcotics,
narcotic_precursors, narcotic_hotspots, ballistics_benches, ballistic_footprints,
reports, trackers, rico_cases, predicate_acts, media, documents, tickets,
raid_compensations, mo_profiles, notifications, audit_log.

No seed/demo data is inserted — every module starts empty with "Create first…" CTAs
and per-module CSV/JSON import (Phase 2).
