# Chapter 5 — Page Guide

[← Handbook index](README.md)

## The routing model

Next.js maps folders under `src/app/` to URLs. This app has three
user-facing routes:

| URL | File | Renders |
|---|---|---|
| `/` | `app/page.tsx` | Redirect shim: legacy `#deep-links`, else last-visited tab, else `/command`. Also the OAuth landing spot — it **waits** for the auth event before redirecting. |
| `/<tab>` | `app/(app)/[tab]/page.tsx` | One of the screens in `PAGE_META`. Invalid slugs → `/command`; legacy `reports` → `/cases`; the 14 intelligence tool slugs render `ToolTabRedirect`, which forwards into `/tools` (below). |
| anything else | `app/not-found.tsx` | Styled 404. |

`(app)/layout.tsx` wraps every tab in `AuthProvider` → `Gate` (sign-in
screens when not authenticated) → `AppShell` (chrome). All tab routes are
**statically pre-rendered** — safe because pages embed no data; everything
fetches after mount behind RLS.

**Deep-link parameters**: `?case=<id>` (open case detail), `?q=` (seed a
registry filter), `?new=1` (open New Case), `?op=` (operation),
`?focus=g:<id>|p:<id>` (network), `?tab=` (case detail tab),
`?tool=<id>&record=<id>` (Investigative Tools — active tab / record tab).

**Shared states**: every screen renders "Loading…" while fetching,
"Could not load: reason" on failure (reads throw), an ALL-CAPS themed
empty state, and a sign-in notice when unauthenticated.

## The screens

One row per leaf tab in `PAGE_META` (`src/lib/nav.ts` — the routing truth).

| Slug | Screen (component) | Data highlights | Extra permissions |
|---|---|---|---|
| `command` | Dashboard (`CommandView` + 8 widgets, incl. the "Jump back in" pins/recents strip — `command/JumpBack.tsx`) | cases, evidence, tickets, trackers, raid comp, user_pins | filter bar/scorecards command-only |
| `analytics` | Division Analytics | cases, evidence, persons (charts) | — |
| `announce` | Announcements | announcements | posting = command |
| `heatmap` | Crime Heatmap | cases, turf, places, raids | — |
| `personnel` | Roster & Commendations | profiles (+ admin RPCs), commendations | admin panel = command |
| `cases` | Case board + detail (keep-alive case sections; saved views via `lib/savedViews`; DataTable row-selection bulk status/lead/archive — chunked, preview-confirmed, no bulk delete) | the whole case constellation | bureau-scoped; bulk lead assign command-only |
| `operations` | Task Forces | operations, cases | — |
| `case-files` | Attachments | case_files + FiveManage | delete = command |
| `rico` | RICO tracker | rico_cases, predicate_acts | — |
| `legal` | Legal Requests (`LegalView`) | legal_requests + versions/exhibits/actions/participants | creator + participants; all workflow writes via definer RPCs |
| `justice` | Justice Portal (`JusticePortalView`) — **RETIRED 2026-07-22**: route/tab removed, memberships deactivated; legal approval is now Bureau Lead+ in the CID `legal` surface (see [DOJ-INTEGRATION.md](../DOJ-INTEGRATION.md) Phase-1 banner) | legal review queues, judge docket, coverage, applications | justice roles + Owner (justice-only members get it as their whole app) |
| `tools` | Investigative Tools workspace (`tools/ToolsView`) — grouped directory + keep-alive tab strip over the 14 tool views below; open tabs persist per user (ids only) and restore RLS-verified | opens the tools below as tabs; Persons & Vehicles records as own tabs | — |
| `persons` ¹ | Persons → IntelProfile | persons, gang_members, vehicles | — |
| `bolo` ¹ | BOLO Board | persons(bolo), warrant reports | — |
| `gangs` ¹ | Gangs | gangs, ranks, members, turf | — |
| `places` ¹ | Places | places, process steps | — |
| `vehicles` ¹ | Vehicle Registry | vehicles + cross-ref scan | — |
| `accounts` ¹ | Account Registry | accounts, handle history | — |
| `indicators` ¹ | Indicators | indicators + deconfliction | — |
| `field-review` ¹ | Intelligence (field review) | field_submissions + claims | — |
| `network` ¹ | Network graph | gangs, persons, members | — |
| `narcotics` ¹ | Narcotics | narcotics + precursors + hotspots | — |
| `ballistics` ¹ | Ballistics | benches + footprints | — |
| `modus` ¹ | M.O. Detector | mo_profiles + `mo_crossref` RPC | — |
| `media` ¹ | Media Vault | media + FiveManage | — |
| `records` ¹ | Records | cid_records | edit = creator/command |
| `penal` | Penal Code | static (no DB) | — |
| `sops` | SOPs & Library | documents + versions | writes = command |
| `guide` | User Guide | static visual guide (generated from docs/USER-GUIDE.md) | — |
| `devdocs` | Developer Handbook (`DevDocsView`) | generated handbook content | **owner-only** |
| `action` | Action Center (`ActionCenterView`) | prioritized pending decisions across cases, command, personnel + Unassigned intel / Expiring BOLOs / Drafts lanes (`lib/actionItems`), type + bureau filters | self-scoped |
| `inbox` | My Desk (`InboxView`) | self-scoped rollup panels (sign-offs, returned cases, follow-ups, tasks, mentions, following, drafts…) | self-scoped |
| `calendar` | Calendar | cases, tasks, shift weeks | — |
| `shifts` | Shift Reports | shift_reports | edit own |
| `audit` | Audit Log | audit_log (DataTable + CSV) | **owner-only** |
| `feedback` | Feedback (sidebar leaf) | feedback | triage = owner flag (`profiles.is_owner`) |
| `profile` | My Profile (`ProfileView`) | own profile, appearance, notification settings | self |
| `command-center` | Command Center (`CommandCenterView`) | personnel admin, approvals, promotions, transfers | command + Owner |
| `owner` | Owner Portal (`OwnerView`) | project health, feedback triage, security testing | **owner-only** |

¹ **Investigative Tools slugs.** These 14 routes stay registered (deep-link
contracts) but no longer render their view directly: the `[tab]` page returns
`ToolTabRedirect`, which `router.replace`s into
`/tools?tool=<slug>` — translating the record param for tools with workspace
record tabs (`RECORD_TAB_TOOLS` in `src/lib/toolsModel.ts`: currently
persons → `?person=` and vehicles → `?vehicle=` become `&record=`) and
carrying every other query param (`?q=`, `?gang=`, `?focus=` …) through
untouched. The views themselves are code-split in
`src/components/tools/toolRegistry.tsx` and render inside the workspace,
unchanged and still RLS-scoped.
