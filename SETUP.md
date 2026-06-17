# CID Portal — Setup & Deployment

Multi-file vanilla-JS front-end (static host) + Supabase backend. No custom server,
no build step.

## 0. Prerequisites
- Supabase project **`cid`** (`jhxuflzmqspidkvjckox`). Resume it if paused.
- A Google Cloud project (for Google OAuth) and a Discord application (for Discord OAuth).
- Optional for local DB work: the [Supabase CLI](https://supabase.com/docs/guides/cli)
  + Docker (`supabase db reset` replays `supabase/migrations/` in filename order).

## 1. Run the migrations
Apply `supabase/migrations/*.sql` in filename order (Supabase CLI `supabase db push`,
or paste into the Dashboard SQL Editor). The lineage's real base schema is
`20260616090000_platform.sql`; the three archived `migrations/archive/*` files are
superseded and are NOT replayed.

This creates the platform tables with RLS (approved-members-only read; create/update
for active members within their bureau; **delete restricted to command staff**),
`updated_at` + audit triggers, realtime publication, and the workflow RPCs
(`signoff_submit` / `signoff_decide` / `signoff_owner_action` / `report_finalize`).

> **Order note — workflow lockdown.** `20260617190300_workflow_write_lockdown.sql`
> adds triggers that block the *direct* write path for sign-off / finalize columns.
> Apply it **only after** the RPC-calling client is deployed, or in-flight sign-offs
> using the old path will break.

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
Two axes, both off the caller's `profiles` row: **role** (`profiles.role`) and
**bureau** (`profiles.division` ∈ `LSB`/`BCB`/`SAB`/`JTF`). Command staff =
`bureau_lead` + `deputy_director` + `director` (director is supreme).

| Role | Read | Create/Edit (own bureau) | Sign-off authority | Delete |
|------|------|--------------------------|--------------------|--------|
| (inactive) | ✗ | ✗ | ✗ | ✗ |
| `detective` | ✓ | ✓ | submit / owner stop-point | ✗ |
| `senior_detective` | ✓ | ✓ | submit / owner stop-point | ✗ |
| `bureau_lead` | ✓ | ✓ (command in own bureau) | approve at Bureau-Lead stage | ✓ |
| `deputy_director` | ✓ | ✓ (cross-bureau) | approve at Deputy stage | ✓ |
| `director` | ✓ | ✓ (cross-bureau) | approve at Director stage | ✓ + member admin |

- **Read = active members only,** scoped to their bureau; JTF + command see across bureaus.
- **Create/Delete = bureau-isolated** (`cases_ins` requires `private.can_create_case(bureau)`;
  delete needs command + row access).
- **Sign-off & finalize are server-authoritative** — only the RPCs change those
  fields; the lockdown triggers reject direct writes.
- Member promotion/activation is command-only (`public.assign_member` RPC).

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
