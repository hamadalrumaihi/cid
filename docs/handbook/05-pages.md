# Chapter 5 — Page Guide

[← Handbook index](README.md)

## The routing model

Next.js maps folders under `src/app/` to URLs. This app has three
user-facing routes:

| URL | File | Renders |
|---|---|---|
| `/` | `app/page.tsx` | Redirect shim: legacy `#deep-links`, else last-visited tab, else `/command`. Also the OAuth landing spot — it **waits** for the auth event before redirecting. |
| `/<tab>` | `app/(app)/[tab]/page.tsx` | One of the screens in `PAGE_META`. Invalid slugs → `/command`; legacy `reports` → `/cases`. |
| anything else | `app/not-found.tsx` | Styled 404. |

`(app)/layout.tsx` wraps every tab in `AuthProvider` → `Gate` (sign-in
screens when not authenticated) → `AppShell` (chrome). All tab routes are
**statically pre-rendered** — safe because pages embed no data; everything
fetches after mount behind RLS.

**Deep-link parameters**: `?case=<id>` (open case detail), `?q=` (seed a
registry filter), `?new=1` (open New Case), `?op=` (operation),
`?focus=g:<id>|p:<id>` (network), `?tab=` (case detail tab).

**Shared states**: every screen renders "Loading…" while fetching,
"Could not load: reason" on failure (reads throw), an ALL-CAPS themed
empty state, and a sign-in notice when unauthenticated.

## The screens

One row per leaf tab in `PAGE_META` (`src/lib/nav.ts` — the routing truth).

| Slug | Screen (component) | Data highlights | Extra permissions |
|---|---|---|---|
| `command` | Dashboard (`CommandView` + 8 widgets) | cases, evidence, tickets, trackers, raid comp | filter bar/scorecards command-only |
| `analytics` | Division Analytics | cases, evidence, persons (charts) | — |
| `announce` | Announcements | announcements | posting = command |
| `heatmap` | Crime Heatmap | cases, turf, places, raids | — |
| `personnel` | Roster & Commendations | profiles (+ admin RPCs), commendations | admin panel = command |
| `cases` | Case board + detail | the whole case constellation | bureau-scoped |
| `operations` | Task Forces | operations, cases | — |
| `case-files` | Attachments | case_files + FiveManage | delete = command |
| `rico` | RICO tracker | rico_cases, predicate_acts | — |
| `legal` | Legal Requests (`LegalView`) | legal_requests + versions/exhibits/actions/participants | creator + participants; all workflow writes via definer RPCs |
| `justice` | Justice Portal (`JusticePortalView`) | legal review queues, judge docket, coverage, applications | justice roles + Owner (justice-only members get it as their whole app) |
| `persons` | Persons → IntelProfile | persons, gang_members, vehicles | — |
| `bolo` | BOLO Board | persons(bolo), warrant reports | — |
| `gangs` | Gangs | gangs, ranks, members, turf | — |
| `places` | Places | places, process steps | — |
| `vehicles` | Vehicle Registry | vehicles + cross-ref scan | — |
| `indicators` | Indicators | indicators + deconfliction | — |
| `network` | Network graph | gangs, persons, members | — |
| `narcotics` | Narcotics | narcotics + precursors + hotspots | — |
| `ballistics` | Ballistics | benches + footprints | — |
| `modus` | M.O. Detector | mo_profiles + `mo_crossref` RPC | — |
| `media` | Media Vault | media + FiveManage | — |
| `records` | Records | cid_records | edit = creator/command |
| `penal` | Penal Code | static (no DB) | — |
| `sops` | SOPs & Library | documents + versions | writes = command |
| `guide` | User Guide | static visual guide (generated from docs/USER-GUIDE.md) | — |
| `devdocs` | Developer Handbook (`DevDocsView`) | generated handbook content | **owner-only** |
| `action` | Action Center (`ActionCenterView`) | prioritized pending decisions across cases, command, personnel | self-scoped |
| `inbox` | My Desk (`InboxView`) | self-scoped rollup panels (sign-offs, returned cases, follow-ups, tasks, mentions, following, drafts…) | self-scoped |
| `calendar` | Calendar | cases, tasks, shift weeks | — |
| `shifts` | Shift Reports | shift_reports | edit own |
| `audit` | Audit Log | audit_log (DataTable + CSV) | **owner-only** |
| `feedback` | Feedback (sidebar leaf) | feedback | triage = owner flag (`profiles.is_owner`) |
| `profile` | My Profile (`ProfileView`) | own profile, appearance, notification settings | self |
| `command-center` | Command Center (`CommandCenterView`) | personnel admin, approvals, promotions, transfers | command + Owner |
| `owner` | Owner Portal (`OwnerView`) | project health, feedback triage, security testing | **owner-only** |
