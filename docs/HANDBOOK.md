# CID Portal — Developer Handbook

> The internal handbook for the CID Portal codebase. It is written so that a
> brand-new developer — even one new to web development — can understand the
> project without asking the original developers anything. Terms are defined
> the first time they appear; every claim is specific to this repository.
>
> **Scope note.** This handbook documents the code as of July 2026 (post
> PR #114). The repository has no server code of its own — the "backend" is a
> hosted Supabase project — so sections that would normally describe API
> route files instead describe the auto-generated database API and the SQL
> that governs it. Where something could not be verified from the repository
> or the live database catalog, the handbook says so explicitly.

---

## Table of Contents

1. [Orientation — what you're looking at](#1-orientation)
2. [Project Overview](#2-project-overview)
3. [Glossary — every term used in this handbook](#3-glossary)
4. [Repository Structure](#4-repository-structure)
5. [Architecture Blocks](#5-architecture-blocks)
6. [The Data Layer — how every read and write happens](#6-the-data-layer)
7. [Authentication & Authorization](#7-authentication--authorization)
8. [Database Documentation](#8-database-documentation)
9. [Pages & Routes](#9-pages--routes)
10. [File-by-File Documentation](#10-file-by-file-documentation)
11. [Feature Documentation & User Flow Maps](#11-features--user-flows)
12. [State Management](#12-state-management)
13. [Forms](#13-forms)
14. [Environment Variables](#14-environment-variables)
15. [External Services](#15-external-services)
16. [Deployment](#16-deployment)
17. [Testing & CI](#17-testing--ci)
18. [Performance Review](#18-performance-review)
19. [UX Review](#19-ux-review)
20. [Security Review](#20-security-review)
21. [Dependency Map](#21-dependency-map)
22. [Change Impact Guide](#22-change-impact-guide)
23. [Suggestions](#23-suggestions)
24. [Dead Code Review](#24-dead-code-review)
25. [Learning Order](#25-learning-order)
26. [Final Summary](#26-final-summary)

---

# 1. Orientation

## What this application is, in one paragraph

The **CID Portal** is a private, real-time case-management website for the
"Criminal Investigation Division" of a Grand Theft Auto V roleplay community.
Detectives sign in, open investigation cases, log evidence and suspects,
chat inside a case, link people/gangs/vehicles/places to cases, route
finished cases up a chain of command for sign-off, and export court-ready
PDF packets. Everything is **live**: when one detective changes something,
every other signed-in detective's screen updates within seconds without
refreshing.

## The 30-second architecture

There are only two moving parts:

```
┌───────────────────────────┐         ┌──────────────────────────────┐
│  The web app (this repo)  │  HTTPS  │  Supabase (hosted backend)   │
│  Next.js + React + TS     │ ──────► │  Postgres DB + Auth +        │
│  runs in the browser,     │ ◄────── │  auto-REST API + Realtime    │
│  hosted on Vercel         │  wss    │  websockets                  │
└───────────────────────────┘         └──────────────────────────────┘
                                             ▲
                     ┌───────────────────────┘
                     │ file uploads only
              ┌──────┴───────┐
              │  FiveManage  │  (external image/video host)
              └──────────────┘
```

- **This repository** contains only the front-end: a Next.js application
  that is compiled to static HTML + JavaScript and served by Vercel.
- **Supabase** is a hosted service that bundles a Postgres database, user
  sign-in ("Auth"), an automatic HTTP API over the database ("PostgREST"),
  and live change notifications ("Realtime"). All business rules that
  matter for security live *inside the database* as SQL policies, functions
  and triggers — not in this repo's TypeScript.
- **FiveManage** hosts uploaded images/videos/PDFs; the database stores
  only the URL.

There is **no custom server**: no Express app, no `/api` folder, no
serverless functions. If you're looking for "the backend code", it is SQL
inside the Supabase project, summarized in [§8](#8-database-documentation).

## The one rule that explains everything else

> **The database is the authority. The UI is a convenience.**

Every permission check you see in React (`canEdit`, `canDelete`, role
checks) only *hides buttons*. The real enforcement is Postgres
**Row Level Security** (defined in §3, detailed in §7): the database
refuses to return or accept rows the signed-in user isn't allowed to touch,
no matter what the JavaScript asks for. Understanding this removes most of
the mystery in the codebase — the client is intentionally "dumb".

---

# 2. Project Overview

## Who uses it

Members of a roleplay police division, in four roles of increasing power
(the database enumerates seven historical role labels, but the app treats
them as tiers — see §7):

| Tier | Roles (as stored) | What they can do |
|---|---|---|
| Member | `detective`, `senior_detective`, `supervisor` | Work cases in their bureau, log intel, file reports |
| Bureau lead | `bureau_lead` | Everything above + first sign-off stage, case-access grants |
| Deputy | `deputy_director` | Second sign-off stage, cross-bureau access |
| Command | `director`, `command` | Everything: approvals, roster, announcements, deletes |

Members also belong to a **bureau** (a sub-division): `LSB`, `BCB`, `SAB`,
or `JTF`. Case visibility is bureau-scoped.

## Main features (each has a section in §11)

- **Case files** — the central record. A kanban board of cases plus a
  full-screen case detail with 12 tabs (Overview, Graph, Evidence, Notes,
  Charges, RICO, Intel, Reports, Tasks, Sign-off, Chat, Timeline).
- **Sign-off routing** — a finished case is submitted and routed
  bureau lead → deputy director → director, entirely by SQL functions.
- **Intelligence registries** — persons, gangs (members/ranks/turf), BOLO
  board, places, vehicles, indicators (phones/serials/aliases with
  cross-case deconfliction), network graph, narcotics, ballistics,
  M.O. detector, media vault, records.
- **Command tools** — dashboard (activity, attention widget, trackers,
  tickets, raid compensation), division analytics charts, announcements,
  crime heatmap, roster & commendations.
- **Personal tools** — My Desk (everything waiting on *you*), watchlist
  ("follow" anything), calendar, weekly shift reports, notifications bell.
- **Reference** — the S.A. Penal Code, SOPs & document library, and the
  in-app visual User Guide.
- **Exports** — court-styled PDF case packets and person dossiers, DOCX and
  Markdown variants, CSV export of the audit log.
- **Global search** — one search box (press `/` or `Ctrl-K`) that does
  typo-tolerant full-text search across nine tables *and* runs commands
  ("new case", "loa", "go to heatmap").

## Technologies and why each was chosen

| Technology | What it is | Why this project uses it |
|---|---|---|
| **Next.js 16 (App Router)** | A framework on top of React that handles routing, builds and optimization. | One `[tab]` route renders all 29 screens; static pre-rendering gives instant loads; Vercel deploys it with zero config. The app began life as a vanilla-JS site and was ported screen-by-screen (see `docs/REACT-PARITY.md`). |
| **React 19** | A library for building UIs out of reusable pieces ("components") that re-render automatically when data changes. | The portal is a highly interactive dashboard; React's model (state → UI) fits it exactly. |
| **TypeScript (strict)** | JavaScript plus compile-time types. | `src/lib/database.types.ts` types every table, so a typo in a column name is a *build error*, not a runtime bug. |
| **Tailwind CSS v4** | Utility-class styling (`class="px-3 text-sm"`). | One dark "investigative" design system defined as tokens in `globals.css`; no separate CSS files per component. |
| **Supabase** | Hosted Postgres + Auth + auto-API + Realtime. | Removes the need to write and host a backend at all; RLS gives real security with a public client key. |
| **zustand** | A tiny global-state library. | Used sparingly (toasts, operations cache) where React context would be overkill. |
| **@xyflow/react (React Flow)** | A node-graph rendering library. | Powers the case investigation graph (i2/Maltego-style link chart). |
| **@react-pdf/renderer** | Builds real PDFs in the browser from React-like components. | Court-styled case packets without any server. |
| **Tiptap v3** | A rich-text editor framework. | WYSIWYG editing of case notes/SOPs while *storing plain Markdown* so exports and other views are untouched. |
| **vitest** | A fast unit-test runner. | Pins the security-critical pure functions (URL allow-list, CSV injection guard). |

Also present: `@tanstack/react-query`, `react-hook-form`, and `zod` are in
`package.json` but are **not currently imported anywhere** — see
[§24 Dead Code](#24-dead-code-review).

## Deployment approach in one line

Push to `main` → Vercel builds `next build` → all 29 tab routes are
pre-rendered as static HTML → served on the production alias; every PR gets
its own preview URL; GitHub Actions runs typecheck/lint/tests/build on every
push (§16, §17).

---

# 3. Glossary

Read this once; every later section assumes these definitions.

**Component** — a reusable piece of UI written as a function that returns
HTML-like markup (JSX). `<CaseBoard />` is a component. Files in
`src/components/` each export one or a few.

**Props** — the inputs a component receives, like function arguments.
`<WatchButton type="vehicle" id={v.id} />` passes two props.

**State** — data a component remembers between renders. Created with the
`useState` **hook**. When state changes, React re-renders the component.

**Hook** — a special function whose name starts with `use…` that lets a
component tap into React features (state, side effects, context). Custom
hooks (e.g. `useTableVersion`) bundle reusable behavior.

**Effect (`useEffect`)** — code that runs *after* render, for side effects
like fetching data. This codebase has a house rule: effects that set state
immediately defer via `setTimeout(0)`/`queueMicrotask` to satisfy the
linter and avoid render loops — you will see this pattern everywhere.

**Context / Provider** — React's way to make a value (like "who is signed
in") available to every component underneath without passing props through
each level. `AuthProvider` in `src/lib/auth.tsx` is the only significant
context here.

**Store** — a global state container that lives outside the component tree.
This repo uses two zustand stores (toasts, operations) and also a
`localStorage` wrapper confusingly named `Store` (device preferences) —
they are unrelated; §12 disambiguates.

**Route / Page** — a URL the app responds to. Next.js maps folders under
`src/app/` to URLs; here one dynamic folder `[tab]` serves 29 screens.

**API / Endpoint** — an HTTP URL a program calls to read or write data.
This app calls only Supabase's auto-generated endpoints
(`/rest/v1/<table>` for tables, `/rest/v1/rpc/<fn>` for functions).

**SQL** — the language of relational databases. **Postgres** is the
database engine Supabase hosts.

**Query** — a request for data (SQL `SELECT`, or the client helper
`list()`).

**Migration** — a versioned SQL script that changes the database schema.
Applied to the *live* project via the Supabase MCP tooling during
development sessions; the repo does not contain a migrations folder — the
live database *is* the source of truth (a documented risk, §23).

**RLS (Row Level Security)** — Postgres feature where every table gets
policy expressions deciding, per row and per user, whether SELECT / INSERT /
UPDATE / DELETE is allowed. The heart of this app's security (§7).

**Trigger** — SQL that runs automatically before/after a row changes.
Used here for audit logging, `updated_at` stamping, and blocking
protected-column writes (§8.5).

**RPC (Remote Procedure Call)** — calling a named database *function* over
HTTP. Used for multi-step operations that must be atomic and
permission-checked server-side (sign-off, member management, search).

**Realtime / Subscription** — Supabase can push a websocket message when a
table changes. A **websocket** is a persistent two-way connection. The app
subscribes once per table and turns messages into version counters (§12).

**Promise / async–await** — JavaScript's way of handling operations that
finish later (like network calls). `await list('cases')` pauses that
function until rows arrive, without freezing the page.

**Cache** — kept-around data to avoid re-fetching. Here: an in-memory
profiles cache, localStorage drafts, and the browser's HTTP cache.

**Webhook** — an HTTP call a service makes *to you* when something happens.
Used only by the development workflow (GitHub → CI), not by the app itself.

**Middleware** — code that runs between request and response. This app has
none (no server); the closest analog is the CSP headers in
`next.config.ts` applied by Vercel's edge.

---

# 4. Repository Structure

```
cid/
├── src/
│   ├── app/                  # Next.js routes (the URL → screen mapping)
│   │   ├── layout.tsx        #   root HTML shell, fonts, theme applier
│   │   ├── page.tsx          #   "/" → redirects into the app
│   │   ├── (app)/layout.tsx  #   the signed-in shell (sidebar, header…)
│   │   ├── (app)/[tab]/page.tsx  # ONE route rendering all 29 screens
│   │   ├── error.tsx / global-error.tsx / not-found.tsx  # error screens
│   │   └── globals.css       #   Tailwind theme tokens + custom CSS
│   ├── components/
│   │   ├── shell/            # navigation chrome: sidebar, header, search…
│   │   ├── ui/               # generic widgets: Modal, DataTable, editor…
│   │   ├── auth/             # the sign-in gate
│   │   ├── cases/            # the flagship feature (10 files)
│   │   ├── command/          # dashboard widgets (10 files)
│   │   └── <25 more feature folders>  # one folder per screen
│   └── lib/                  # ALL shared logic: db, auth, realtime, pdf…
├── docs/                     # this handbook, user guide, roadmaps
├── .github/                  # CI workflow + Dependabot
├── next.config.ts            # security headers (CSP) + build config
├── vercel.json               # framework + public build env for previews
├── vitest.config.ts          # unit-test config (@ alias, node env)
├── tsconfig.json             # strict TS, "@/..." path alias to src/
└── package.json              # dependencies & scripts
```

### Folder-by-folder

| Folder | Purpose | Depended on by | Talks to |
|---|---|---|---|
| `src/app/` | Maps URLs to screens; owns the HTML skeleton, error pages, global CSS. Exists because Next.js requires it (file-system routing). | Everything renders inside it | `components/shell` (layout), `components/*` (the screens), `lib/nav` (valid tabs) |
| `src/components/shell/` | The persistent chrome around every screen: sidebar, header, bottom nav, sub-tabs, global search palette, notifications bell, connection banner, profile/appearance modals. | Every screen (it wraps them) | `lib/auth`, `lib/nav`, `lib/search`, `lib/realtime`, `lib/store` |
| `src/components/ui/` | Feature-agnostic widgets: `Modal` (with dirty-guard), `dialog` (confirm/prompt), `Toaster`, `DataTable`, `RichEditor`. | Almost every feature folder | `lib/toast`, `lib/format` |
| `src/components/auth/` | `Gate.tsx` — the sign-in screen and the "signed in but not approved" screen. | `(app)/layout.tsx` | `lib/auth`, `lib/supabase` |
| `src/components/<feature>/` | One folder per screen (see §9 for the full list). Each is self-contained: fetches its own data, owns its modals. | The `[tab]` router only | `lib/db`, `lib/auth`, `lib/realtime`, feature-specific libs |
| `src/lib/` | Every piece of shared logic. **This is the most important folder in the repo** — read it before touching features. | All components | Supabase (network), browser APIs |
| `docs/` | Human documentation: this handbook, `USER-GUIDE.md` (canonical text of the in-app guide), `HARDENING.md` (security checklist status), plus historical roadmap/handoff notes. | Developers; `guideContent.ts` is generated from USER-GUIDE.md | — |
| `.github/` | `workflows/ci.yml` (typecheck/lint/test/build on every push/PR) and `dependabot.yml` (weekly dependency PRs). | The repo's quality gates | GitHub Actions |

---

# 5. Architecture Blocks

The codebase groups into nine logical blocks. Risk = how likely a careless
change is to break something important.

### Block 1 — Configuration & Build
`next.config.ts`, `vercel.json`, `tsconfig.json`, `vitest.config.ts`,
`package.json`, `.github/*`, `eslint.config.mjs`
- **Purpose**: compile, secure (CSP headers), deploy, and gate the app.
- **Data flow**: none at runtime except CSP headers served with every page.
- **Risk: HIGH.** The CSP in `next.config.ts` is load-bearing: it took a
  deliberate change (`wasm-unsafe-eval`) to make PDF export work. Tightening
  it can silently kill features (PDF/WASM, Supabase websockets). `vercel.json`
  carries the public env for preview builds — removing it 404s previews.
- **Understand first**: §14 (env), §16 (deployment), §20 (why each CSP
  directive exists).

### Block 2 — Routing & App Shell
`src/app/*`, `src/components/shell/*`, `src/lib/nav.ts`
- **Purpose**: URL ↔ screen mapping; the constant chrome; navigation
  metadata (`PAGE_META`, `NAV_CATEGORIES`, `TAB_LABEL`).
- **Data flow**: URL → `[tab]/page.tsx` switch → feature view inside
  `AppShell`; `useNavBadges` polls/streams counts onto the Command button.
- **Risk: MEDIUM-HIGH.** `nav.ts` is a three-way contract (PAGE_META keys =
  route slugs = TAB_LABEL keys); missing one entry silently redirects the
  tab to /command.
- **Understand first**: §9.

### Block 3 — Auth & Identity
`src/lib/auth.tsx`, `src/lib/roles.ts`, `src/lib/profiles.ts`,
`src/components/auth/Gate.tsx`
- **Purpose**: sign-in state machine, the `useAuth()` context, role→
  capability derivation (`canEdit`/`canDelete`), profile cache.
- **Risk: HIGH.** Everything reads `useAuth()`; a bug here signs everyone
  out or (worse) *hides* the fact that RLS will reject writes.
- **Understand first**: §7 in full.

### Block 4 — Data Access
`src/lib/db.ts`, `src/lib/supabase.ts`, `src/lib/database.types.ts`
- **Purpose**: the ONLY sanctioned path to the database. Typed helpers
  with a strict error contract (§6).
- **Risk: HIGH.** Every feature calls it; the undo/restore logic
  (`deleteWithUndo`) preserves ids and children — subtle.
- **Understand first**: §6.

### Block 5 — Realtime
`src/lib/realtime.ts`
- **Purpose**: one websocket channel per table → in-memory version
  counters; `useTableVersion('cases')` re-renders subscribers on any change.
- **Risk: MEDIUM.** A leak here = stale screens or duplicate channels.
- **Understand first**: §12.

### Block 6 — Feature Views
`src/components/<feature>/*` (27 folders)
- **Purpose**: the actual screens. Uniform internal shape: fetch on mount +
  version bump → `refresh()`; permission-gated buttons; modals for
  create/edit; toasts + undo for destructive actions.
- **Risk: varies.** `cases/CaseDetail.tsx` (~1,900 lines, 12 tabs) is the
  highest-risk single file in the repo. Registry views (vehicles, persons…)
  are low-risk and near-identical — the best place to learn (§25).

### Block 7 — Domain Libraries
`src/lib/{signoff,forms,penal,packet,pdf,docx,search,notify,notifText,watchlist,operations,fivemanage}.ts`
- **Purpose**: business logic that multiple views share (sign-off labels,
  report templates, penal code math, export pipeline, search, notifications).
- **Risk: MEDIUM.** Mostly pure functions; the export pipeline
  (`packet → pdf/docx`) and `notify` (writes to other users) deserve care.

### Block 8 — UI Primitives
`src/components/ui/*`, `src/lib/{toast,format,markdown,safeUrl,store,drafts}.ts`
- **Purpose**: the widgets and helpers everything is assembled from.
- **Risk: MEDIUM.** `safeUrl` and `markdown.tsx` are security surfaces
  (XSS); both are unit-tested / hard-ruled.

### Block 9 — The Database (lives in Supabase, not the repo)
47 tables, 22 `private.*` helper/trigger functions, 15 public RPCs,
RLS on everything, realtime publication on 42 tables.
- **Risk: HIGHEST.** Schema changes must stay additive (the deployed app
  and any open browser tabs keep using old column lists). §8 is its map.

---

# 6. The Data Layer

Every read and write in the app goes through `src/lib/db.ts`. Learn its
contract once and every feature file becomes readable.

## Plain-English first

Think of `db.ts` as the app's *librarian*. Components never walk into the
database themselves; they hand the librarian a request ("list all vehicles,
newest first") and get back either the rows or a clearly-labeled error.
The librarian also handles the tricky stuff: retrying when the network
blips, and the six-second "Undo" window after a delete.

## The contract (memorize this)

| Helper | Signature (simplified) | Error behavior |
|---|---|---|
| `list(table, opts)` | `→ Promise<Row[]>` with `select/eq/in/order/limit` | **THROWS** on error — callers wrap in try/catch and show a load-failure notice |
| `insert(table, row)` | `→ { data, error }` | **RETURNS** the error — callers must check `res.error` and toast it |
| `update(table, id, patch)` | `→ { data, error }` | returns error |
| `updateWhere(table, match, patch)` | compare-and-swap by non-id columns | returns error; **empty data + no error = predicate matched nothing** (lost race or RLS-blocked) — callers must treat that as failure |
| `updateNoSelect(table, id, patch)` | update without reading back | for tables where read is narrower than write (profiles email) |
| `remove(table, id)` / `removeWhere(table, eq)` | delete | returns error |
| `rpc(fn, args)` | call a database function | returns error |
| `withRetry(fn)` | wraps a thrower with backoff retries | for the *initial* load of important screens |
| `deleteWithUndo(table, row, opts)` | delete + 6s Undo toast that re-inserts **preserving ids**; `opts.children` snapshots cascade-children and restores them too | the safety net for every destructive button |
| `fetchCustody(caseId)` | joined custody-chain read | throws |

Two consequences you'll see in every view:

1. **Reads**: `try { setRows(await withRetry(() => list('vehicles', …))) } catch (e) { setErr(…) }`
2. **Writes**: `const res = await insert(…); if (res.error) { toast(res.error.message, 'danger'); return }`

A write that violates RLS does **not** throw — it comes back as `error`
(or as zero updated rows). The UI must surface it; several past bugs were
"silent no-ops" where a result was discarded (fixed by the `mutateThen`
helper in CaseDetail).

## Types

`src/lib/database.types.ts` (~2,450 lines) mirrors the live schema:
`Tables<'cases'>` is the row type, `TablesInsert<…>`/`TablesUpdate<…>` the
write shapes. It is **hand-maintained**: when a migration adds a column or
table, the matching type is added by hand in the same PR. If types and
schema drift, you get runtime nulls the compiler can't see — treat every
migration PR as incomplete until this file is touched.

---

# 7. Authentication & Authorization

## Authentication (who are you?) — the flow

1. `/` renders `Gate.tsx`. Three ways in, all via **Supabase Auth**:
   Discord OAuth, Google OAuth, or an emailed magic link (a one-time
   sign-in URL). There are no passwords to store.
2. Supabase redirects back with a **session** — a signed JWT (JSON Web
   Token: a tamper-proof identity card) kept in localStorage and attached
   by the client library to every request automatically.
3. `AuthProvider` (`src/lib/auth.tsx`) listens to auth events and exposes
   a state machine: `'loading' | 'out' | 'in'` plus the user's `profile`
   row. The whole app reads it through the `useAuth()` hook.
4. On first ever sign-in, a database trigger (`private.handle_new_user`)
   creates a `profiles` row with `active = false`. The UI shows
   *"signed in but not yet approved"* until a Command member activates the
   profile from the Roster screen. An inactive profile passes
   authentication but fails **every** RLS check (`private.is_active()`),
   so they can see nothing.

## Authorization (what may you do?) — three layers

**Layer 1 — UI hints (cosmetic).** `useAuth()` derives booleans from the
profile's role: `canEdit` (any active member for shared intel; role-scoped
for cases) and `canDelete` (command tier). These only hide buttons.

**Layer 2 — RLS policies (the real wall).** Every one of the 47 tables has
policies built from six `SECURITY DEFINER` helper functions in the
`private` schema (SECURITY DEFINER means "runs with the function owner's
privileges" — needed so the helper can read `profiles` regardless of the
caller's own row access):

| Helper | True when… |
|---|---|
| `private.is_active()` | caller's profile exists and `active = true` |
| `private.is_command()` | caller's role is director/command tier |
| `private.can_delete()` | command tier (deletes are command-only nearly everywhere) |
| `private.can_announce()` | roles allowed to post announcements |
| `private.can_access_bureau(b)` | caller's bureau = b, or caller is command/deputy |
| `private.can_access_case(case_id)` | bureau match OR case lead OR creator OR an explicit `case_access_grants` row OR command |

The standard patterns you'll meet in §8's table matrix:

- **Shared intel** (persons, gangs, vehicles, places, indicators, media,
  narcotics, ballistics, operations, tickets, commendations…):
  read/insert/update for any active member, delete command-only.
- **Case-scoped** (evidence, reports, tasks, messages, intel links, RICO,
  raid comp, MO profiles, sign-off history): every action requires
  `can_access_case(case_id)` — other bureaus simply see nothing.
- **Own-row** (notifications, watchlist, shift reports, feedback): keyed to
  `auth.uid()` (the caller's user id), with command/owner overrides where
  sensible.
- **Special**: `audit_log` is readable by exactly one hard-coded owner id;
  `app_secrets` has RLS enabled and **no policies at all** — deny-all to
  browsers, readable only by the service key (deliberate).

**Layer 3 — Guard triggers (protecting columns even from allowed writers).**
- `private.guard_profile` — members can update their own profile row, but
  the trigger blocks changing `role`, `active`, or `bureau` unless the
  caller is command; role/bureau changes go through the `assign_member` RPC.
- `private.block_direct_signoff` — the sign-off columns on `cases`
  (`signoff_status`, `signoff_stage`, assignee…) cannot be written by a
  normal UPDATE; only the `signoff_*` RPCs (SECURITY DEFINER) may move them.
- `private.block_direct_report_finalize` — a report's `finalized` flag only
  moves via the `report_finalize` RPC (which stamps the badge).
- `private.block_tracker_self_cosign` — a tracker's deputy/director
  signatures must be two *different* people; you cannot co-sign your own.

**Why this design**: the anon (public) API key ships in the JavaScript
bundle — anyone can read it. That is safe *only* because the key grants
nothing by itself; every row crosses RLS. Hiding logic in the client would
be security theater; putting it in SQL makes it real. Additionally, all
five previously anonymous-callable RPCs had `EXECUTE` revoked from `anon`
in the July 2026 hardening pass, so unauthenticated visitors cannot invoke
any RPC at all.

## Sessions

Sessions auto-refresh (the Supabase client rotates tokens in the
background). An expired session flips `useAuth()` to `'out'`, and every
screen renders its "sign in to view" notice; drafts live in localStorage so
nothing typed is lost.

## Route protection

There are no server-side protected routes — every route serves the same
static shell. Protection is: (1) `Gate` blocks the UI when signed out, and
(2) even if someone bypassed the UI entirely, RLS returns them zero rows.
This is why static pre-rendering of all 29 routes is safe.

---

# 8. Database Documentation

The database is a Supabase-hosted Postgres project. The repo does not carry
a migrations folder; migrations were applied to the live project during
development (named snapshots exist in Supabase's migration history, e.g.
`add_indicators_registry`, `security_hardening_and_fk_indexes`). The
**live schema is the source of truth**; `src/lib/database.types.ts` mirrors
it in TypeScript. Everything below was read from the live catalog in July
2026.

## 8.1 Enumerated types (fixed value lists)

| Enum | Values |
|---|---|
| `app_role` | detective, senior_detective, supervisor, bureau_lead, deputy_director, director, command |
| `bureau` | LSB, BCB, SAB, JTF |
| `case_status` | open, active, cold, closed |
| `assign_role` | primary, support |
| `report_kind` | initial, supplemental, followup |
| `evidence_tamper` | intact, compromised, released, destroyed |
| `media_type` | image, video, fivemanage, document |
| `doc_kind` | doc, sheet, pdf, zip |
| `location_type` | drug_lab, stash_house, dead_drop, front_business, chop_shop |
| `bench_type` | street, organized |
| `tracker_status` | pending, authorized, expired |
| `threat_level` / `density` | low, medium, high |

## 8.2 Tables (47) — grouped by RLS pattern

“Written by” below names the screens; the mechanical writer is always the
signed-in browser via PostgREST.

### The hub: cases and its satellites (case-scoped RLS — every action needs `can_access_case`)

| Table | Purpose | Read/written by |
|---|---|---|
| `cases` (22 cols) | The central case record: number, title, bureau, status, lead, summary, follow-up date, stale-escalation stamps, operation link, and the **sign-off columns** (status/stage/assignee/submitted_by — writable only via RPC, enforced by trigger). | Board & detail (`CasesView`, `CaseDetail`, `CaseBoard`, `CaseModal`); read by ~15 other screens for pickers/rollups. INSERT gated by `can_create_case(bureau)`; SELECT/UPDATE/DELETE by `can_access_case_row(...)` (+ `can_delete` for delete). |
| `case_assignments` | Officers on a case (primary/support). | CaseDetail Overview. |
| `evidence` (13) | Items with code, type, location, chain state (`tamper`), collected_at/by. | CaseDetail Evidence tab; quick-log on Command; analytics trend. |
| `custody_chain` | Transfer log per evidence item; INSERT/SELECT only (history is append-only). | CaseDetail evidence detail. |
| `reports` (12) | Filled report forms: `template` id, `kind` (initial/supplemental/followup), `seq`, JSON `fields`, `finalized` + signature. Finalize only via `report_finalize` RPC (trigger-blocked). | CaseDetail Reports tab; BOLO board reads warrants; graph. |
| `case_tasks` (10) | Checklist tasks (+`parent_id` sub-tasks, due dates). Delete: command **or own row**. | CaseDetail Tasks; calendar; My Desk. |
| `case_messages` | Case chat with `mentions`/`links` JSON; author stamped by trigger; edit/delete: author or command. | CaseDetail Chat. |
| `case_intel_links` | Polymorphic links case→(person\|gang\|place) with `kind`, `ref_id`, `role`, `note`. The source of the Intel tab, graph edges, packets, deconfliction. | CaseDetail Intel, CaseGraphTab (v2 also inserts/deletes), vehicles cross-ref. |
| `case_files` (9) | External file attachments (FiveManage URLs) keyed by **case_number** (text) rather than id — a vanilla legacy; RLS uses `can_access_case_number`. | Attachments screen (`CaseFilesView`) — note: files are NOT a CaseDetail tab. |
| `case_signoff_history` | Append-only log of every sign-off action (verb, actor, note). | CaseDetail Sign-off + Timeline. |
| `rico_cases` + `predicate_acts` | RICO enterprise wrapper per case + predicate act rows (linked to evidence). | RICO screen + case RICO tab. |
| `mo_profiles` | M.O. (modus operandi) term sets per case, powers `mo_crossref`. | M.O. Detector screen. |
| `raid_compensations` (10) | Raid payout ledger rows per case. | Command → RaidComp widget. |
| `trackers` (14) | GPS tracker authorizations: code, target, case/bureau scope, `status`, deputy/director signatures (self-co-sign blocked by trigger). SELECT: case-scoped when case-linked, else bureau-scoped. INSERT/UPDATE/DELETE: command. | Command → Trackers. |
| `case_access_grants` / `case_access_requests` | Cross-bureau case sharing: grants (by lead/command via `can_grant_case`) and member-filed requests with decisions. | CaseDetail access panel; My Desk. |
| `case_templates` (14) | New-case prefill templates incl. `tasks` JSON checklist. Any active member reads; command writes. | CaseModal; Personnel admin. |

### Shared intel registries (active-member read/write, command-only delete)

`persons` (16 cols — name, alias, status, gang link, felony count, mugshot…),
`gangs` (8) + `gang_ranks` + `gang_members` (15 — person link, rank, case,
flags) + `gang_turf`, `vehicles` (10 — plate/model/color/owner/gang),
`places` (11 — type, area, controlling gang, narcotic link) +
`place_process_steps`, `narcotics` (9) + `narcotic_precursors` +
`narcotic_hotspots`, `ballistics_benches` (10) + `ballistic_footprints`,
`indicators` (7 — kind/value/note per case, powering deconfliction),
`media` (14 — vault entries with type/url/links to person/gang/place),
`cid_records` (15 — standalone records registry; update: creator or
command), `operations` (7 — task forces), `tickets` (11 — command queue),
`commendations` (10), `documents` (10) + `documents_versions` (SOPs &
library; protected folders SOPs/Resources/Personnel/Gang Intel are
command-write-only via the policy's folder check).

**Read by**: their matching screens plus every picker (case intel linking,
graph, packets, search). **Deleted by**: command only (`can_delete`),
always through `deleteWithUndo`.

### Own-row tables (keyed to `auth.uid()`)

| Table | Notes |
|---|---|
| `notifications` (6) | user_id + type + JSON payload; created ONLY via `create_notification` RPC (so the actor can't be forged); read/cleared by the owner (bell + My Desk). |
| `watchlist` (5) | The ☆ follow list (type + ref id + label). |
| `shift_reports` (11) | Weekly report per author; command may read/update all. |
| `feedback` (8) | Suggestions; owner CRUD + two hard-coded triage owner ids get ALL. |
| `profiles` (14) | One row per member: display name, badge, role, bureau, active, LOA, discord id, avatar, removed_at. Self-update allowed but `guard_profile` trigger blocks self-changing role/active/bureau; command manages via RPCs. `email` column readable by command only (column grant) — the reason for `PROFILE_COLS`/`updateNoSelect`. |

### System tables

| Table | Notes |
|---|---|
| `audit_log` (7) | Populated exclusively by the `private.audit()` trigger on 20 tables (see 8.5). SELECT restricted to one owner UUID. No client write path. |
| `announcements` (11) | Posts with pinning; write gated by `can_announce()`, read by all active. Author stamped by trigger. |
| `app_secrets` (3) | Server-side key/value (e.g. Discord webhook when that experiment ran). RLS on, **zero policies** = invisible to all client roles. Deliberate. |

## 8.3 Public RPC functions (the app's real "API endpoints")

All are `SECURITY DEFINER` (run with elevated rights, then do their own
permission checks) unless noted. Anonymous execution was revoked in the
hardening pass — a valid session is required for all of them.

| RPC | Called from | What it does |
|---|---|---|
| `search_all(q)` | SearchPalette (`runSearch`) | pg_trgm fuzzy search across 9 tables, RLS-scoped (SECURITY **INVOKER** — the one non-definer, deliberately, so results honor row access). |
| `signoff_submit(p_case)` | CaseDetail Sign-off | Validates the caller owns/can access the case, computes the first stage + assignee (`private.signoff_route/pick`), stamps the sign-off columns, writes history. |
| `signoff_decide(p_case, decision, note)` | CaseDetail Sign-off | Approve/deny/request-changes by the current assignee; advances or returns the chain; history + notification. |
| `signoff_owner_action(p_case, action)` | CaseDetail | Owner-side actions (recall/resubmit/complete). |
| `report_finalize(p_report, p_badge)` | CaseDetail Reports | The only way to set `finalized`; stamps signature + badge. |
| `assign_member(target, role, division, active)` | Personnel AssignModal | Command-only (checked inside): sets role/bureau/active on a profile. |
| `admin_member_emails()` | Personnel AdminPanel | Command-only: returns roster emails (bypasses the column grant deliberately, after checking the caller). |
| `admin_remove_member(p_target)` / `admin_restore_member(p_target)` | AdminPanel | Soft remove/restore (stamps `removed_at`). |
| `create_notification(user, type, payload)` | `lib/notify.ts` | Inserts a notification for another user with the actor stamped server-side (prevents forgery). |
| `mo_crossref(terms[])` | ModusView | Cross-references M.O. terms across cases the caller can see. |
| `bootstrap_command/bootstrap_director(email)` | nobody in-app | One-time setup helpers from initial provisioning. Candidates for removal (§23). |
| `cid_touch_updated_at()` / `set_case_closed_at()` / `stamp_author_identity()` | triggers only | Not called directly. |

## 8.4 Private helper functions

`private.is_active / is_command / role / can_delete / can_announce /
can_access_bureau / can_access_case / can_access_case_number /
can_access_case_row / can_create_case / can_grant_case` — the policy
building blocks (§7). `private.signoff_pick/route/status_of` — the routing
brain: given a stage and bureau, pick the next assignee (skipping LOA
members) and compute the resulting status.

## 8.5 Triggers

| Trigger family | Tables | Effect |
|---|---|---|
| `private.audit()` AFTER I/U/D | 20 tables (cases, evidence, reports, tasks, persons, gangs+members, vehicles, places, media, documents, tickets, trackers, custody, predicate/rico, raid comp, templates, assignments, access requests) | Writes actor/action/entity/detail to `audit_log`. **This is the app's logging.** |
| `private.touch()` / `touch_cases()` / `cid_touch_updated_at()` BEFORE UPDATE | ~25 tables | Keeps `updated_at` honest (also drives "closed week ≈ last update" in analytics). |
| `stamp_author_identity()` BEFORE INSERT | case_messages, announcements | Overwrites author columns with the real caller — client-sent author is ignored. |
| Guard triggers | profiles, cases, reports, trackers | The four column-protection rules from §7 layer 3. |
| `set_case_closed_at()` BEFORE UPDATE | cases | Stamps closure timestamp on status → closed. |
| `private.handle_new_user()` | auth.users (Supabase schema) | Creates the inactive profile on first sign-in. |

## 8.6 Realtime publication

42 of the 47 tables are in the `supabase_realtime` publication (everything
except `app_secrets`, `feedback`, `watchlist`, `operations`, `indicators`…
— note **`indicators` IS included**; the current exceptions are
`app_secrets`, `feedback`, `watchlist` and `operations`). A table not in
the publication still works, but its screen only refreshes on remount —
if you add a table and its screen feels stale, this is the first thing to
check.

## 8.7 What breaks if the schema changes

- **Renaming/removing a column** breaks: `database.types.ts` (compile
  error only after it's hand-updated — until then, silent `undefined` at
  runtime), any `select` projection strings (checked at runtime, not
  compile time — grep for the column name!), RLS policies referencing it,
  and open browser sessions running the old bundle. **Rule: additive only.**
- **Adding a table**: add types by hand, add RLS (a table without policies
  is invisible, not open — RLS is enabled by default here), add to the
  realtime publication, add an FK index (the advisor will flag it).
- **Changing an enum**: Postgres enums can only be appended, and the
  TS union in `database.types.ts` + any UI constant (e.g. `CASE_STATUSES`,
  the indicator `KINDS`) must be updated together.

---

# 9. Pages & Routes

## The routing model

Next.js's **App Router** maps folders to URLs. This app has exactly three
user-facing routes:

| URL | File | What renders |
|---|---|---|
| `/` | `src/app/page.tsx` | Redirects to the last-visited tab (from the Store blob) or `/command`. |
| `/<tab>` | `src/app/(app)/[tab]/page.tsx` | One of 29 screens (below). Invalid slugs redirect to `/command`; the legacy `reports` slug redirects to `/cases`. |
| anything else | `src/app/not-found.tsx` | Styled 404. |

`(app)` is a **route group** (the parentheses keep it out of the URL); its
`layout.tsx` wraps every tab in `AuthProvider` → `Gate` → `AppShell`
(sidebar, header, sub-tabs, toaster, connection banner). All 29 tab pages
are **statically pre-rendered** at build time (`generateStaticParams` over
`PAGE_META`) — safe because no page embeds data; every screen fetches
after mount, gated by RLS.

Deep-link parameters (all optional, read via `useSearchParams`):
`?case=<id>` opens a case detail; `?q=<text>` pre-filters registry
screens; `?new=1` opens the New Case modal (from the ⌘K palette).

## The 29 screens

| Category | URL slug | Screen (component) | Data highlights |
|---|---|---|---|
| Command | `command` | Dashboard (`CommandView` + 8 widgets) | cases, evidence, tickets, trackers, raid comp, profiles |
| | `analytics` | Division Analytics (`AnalyticsView`) | cases, evidence, persons — charts, RLS-scoped |
| | `announce` | Announcements (`AnnounceView`) | announcements (+ unread tracking in Store) |
| | `heatmap` | Crime Heatmap (`HeatmapView`) | cases, gang_turf, places — SVG map w/ pan-zoom |
| | `personnel` | Roster & Commendations (`PersonnelView`) | profiles (+ admin RPCs), commendations |
| Cases | `cases` | Case Files board + detail (`CasesView`/`CaseDetail`) | the whole case constellation |
| | `operations` | Operations/Task Forces (`OperationsView`) | operations, cases |
| | `case-files` | Attachments (`CaseFilesView`) | case_files + FiveManage upload |
| | `rico` | RICO (`RicoView`) | rico_cases, predicate_acts |
| Intelligence | `persons` | Persons (`PersonsView` → `IntelProfile`) | persons, gang_members, vehicles, cases |
| | `bolo` | BOLO Board (`BoloView`) | persons(status), vehicles, warrant reports |
| | `gangs` | Gangs (`GangsView`) | gangs, ranks, members, turf |
| | `places` | Places (`PlacesView`) | places, process steps |
| | `vehicles` | Vehicle Registry (`VehiclesView`) | vehicles + cross-ref scan |
| | `indicators` | Indicators (`IndicatorsView`) | indicators + deconfliction |
| | `network` | Network graph (`NetworkView`) | gang_members, persons, gangs |
| | `narcotics` | Narcotics (`NarcoticsView`) | narcotics + precursors + hotspots |
| | `ballistics` | Ballistics (`BallisticsView`) | benches + footprints |
| | `modus` | M.O. Detector (`ModusView`) | mo_profiles + `mo_crossref` RPC |
| | `media` | Media Vault (`MediaView`) | media + FiveManage |
| | `records` | Records (`RecordsView`) | cid_records |
| Reference | `penal` | Penal Code (`PenalView`) | static `PENAL_CODE` (no DB) |
| | `sops` | SOPs & Library (`SopsView`) | documents + versions |
| | `guide` | User Guide (`GuideView`) | static (visual guide) |
| Oversight | `inbox` | My Desk (`InboxView`) | cases, tasks, notifications, watchlist, mentions… |
| | `calendar` | Calendar (`CalendarView`) | cases (follow-ups), tasks (due), shift weeks |
| | `shifts` | Shift Reports (`ShiftsView`) | shift_reports + auto-rollup |
| | `audit` | Audit Log (`AuditView`, owner-only) | audit_log via DataTable |
| (sidebar leaf) | `feedback` | Feedback (`FeedbackView`) | feedback |

Every screen shares the same loading/error/empty conventions: a "Loading…"
notice while fetching, a "Could not load: <reason>" notice on failure
(reads throw), an ALL-CAPS themed empty state, and a sign-in notice when
`state !== 'in'`.

---

# 10. File-by-File Documentation

Format per file: purpose → data (tables/RPCs/realtime) → key behavior &
gotchas → connections → **change impact** → risk. Files are grouped by
block. Line counts are approximate (July 2026).

## 10.1 `src/lib/` — the shared foundation

### `src/lib/supabase.ts` (26)
The lazy singleton client. Exports `isConfigured` (env vars present and not
placeholders — false renders the "setup" gate) and `supabase()` (creates
the client on first call with `persistSession`, `autoRefreshToken`,
`detectSessionInUrl` — the last one is what completes OAuth/magic-link
redirects). Comment enforces: **never a service_role key in this app**.
**Change impact**: everything — every network call resolves through it.
**Risk: HIGH.**

### `src/lib/db.ts` (236)
The librarian (§6). Beyond the contract table there:
`deleteWithUndo` snapshots cascade children (`opts.children`) and
FK-null-on-delete rows (`opts.setNullRefs`) *before* deleting, aborts with
a danger toast if a snapshot read fails (never risk an unrestorable
cascade), and its Undo re-inserts parents preserving ids, then children,
then re-applies nulled FKs. `withRetry` is **reads only** — mutations must
never auto-repeat. Internally a `raw()` cast collapses supabase-js
generics; the exported signatures stay fully typed.
**Imported by ~44 components + 6 libs.**
**Change impact**: the throw-vs-return split is relied on everywhere;
changing it is an app-wide refactor. **Risk: HIGH.**

### `src/lib/database.types.ts` (~2,740)
Hand-maintained mirror of the live schema: `Tables/TablesInsert/
TablesUpdate/Enums/Functions/Json`. **Change impact**: every typed call
site; must move in lockstep with migrations. **Risk: HIGH** (drift =
silent runtime `undefined`).

### `src/lib/auth.tsx` (194)
The auth state machine (§7). Notables: `PROFILE_COLS` deliberately omits
`email` (command-only column grant — selecting it as a member is DENIED);
`email` is merged from the auth session instead. `evaluate()` is serialized
by an `evalSeq` ref so bursty auth events can't let a stale result
overwrite a newer one. Sign-out also calls `removeAllChannels()` +
`resetRealtime()`. A profile fetch *failure* shows the retry ("error")
screen, never fake-"pending". Discord id is captured into the profile
best-effort on sign-in.
**Change impact**: Gate rendering, every `useAuth()` consumer (~40 files),
realtime lifecycle. **Risk: HIGH.**

### `src/lib/realtime.ts` (56)
One channel per table, once per session (module-level `registered` Set —
this is the fix for the vanilla double-subscribe bug). Events bump a
zustand `versions[table]` counter; `useTableVersion(table)` subscribes on
mount and returns it. Teardown split: auth removes channels, `resetRealtime`
forgets registrations. **Change impact**: freshness of ~35 views.
**Risk: MEDIUM-HIGH.**

### `src/lib/nav.ts` (85)
The navigation contract: `PAGE_META` (tab → title/sub; its keys ARE the
valid URL slugs), `NAV_CATEGORIES` (5 categories → tab lists),
`TAB_LABEL`, derived `TAB_CATEGORY`/`CAT_DEFAULT`, `isValidTab`, plus two
UI-mirror constants: `AUDIT_OWNER_ID`, `FEEDBACK_OWNER_IDS` (RLS enforces
the real rule; these just hide UI). **Change impact**: adding a screen
touches PAGE_META + a category's tabs + TAB_LABEL + the `[tab]` switch —
miss one and the tab 404s/redirects or the strip has no label.
**Risk: MEDIUM-HIGH.**

### `src/lib/roles.ts` (60)
Role/bureau vocabulary: `ROLE_ORDER` seniority, `ROLE_LABEL`,
`COMMAND_ROLES`, `BUREAUS`, `roleRank`, `isCommandRole`, and the gotcha
pair: `meIsCommand(me)` (checks `active` AND role — the correct gate) vs
deprecated `isCommand` (role only). **Risk: MEDIUM-HIGH** (feeds auth's
capability derivation).

### `src/lib/profiles.ts` (49)
The roster cache: zustand store (`fetch` keeps the previous cache on error
so names degrade gracefully rather than blank), `officerName(id)`
(synchronous read — returns 'Officer' if the cache isn't loaded yet),
`activeProfiles()` (assignee/mention pools). `ROSTER_COLS` again omits
email. **Imported by ~24 files.** **Risk: MEDIUM-HIGH.**

### `src/lib/toast.ts` (62)
zustand toast store + imperative `toast(msg, type)` / `undoToast(msg, fn)`.
Every message passes `humanizeError()` — regex-maps Postgres/PostgREST
errors (RLS denial, 23505 duplicates, 23503 FK, JWT expiry, schema cache,
network) to human copy so DB internals never surface. **Risk: MEDIUM**
(weakening humanizeError leaks raw errors app-wide).

### `src/lib/store.ts` (24) & `src/lib/drafts.ts` (18)
`Store.get/set` wraps ONE localStorage JSON blob under key `cid-portal-v3`
— the same key the legacy vanilla app used, so preferences/pins/filters
carry across. Keys in use: `tab`, `collapsed`, `accent`, `density`,
`annSeen`, `annDismissed`, `casesScope`, `casesView`, `caseFilters`,
`caseViews`, `recentCases`, `pinnedCases`, `benchType`, `watchSeen`,
`recentSearches`, `graphLayout:<caseId>`. **Renaming a key breaks
continuity.** `Drafts` (namespaced `cid-draft:*`) currently has **zero
importers** — dead code (§24). **Risk: MEDIUM / LOW.**

### `src/lib/format.ts` (55)
`timeAgo`, `todayISO` (local, not UTC), `fmtUSD`, `slug`, `initials`,
`downloadBlob` (the anchor-click trick every export uses),
`downloadTextFile`, `copyText` (clipboard + toast). **Risk: MEDIUM**
(tiny but universal; `downloadBlob` underpins all exports).

### `src/lib/safeUrl.ts` (15)
The XSS gate: allow-list schemes (http/https/mailto), reject control
characters (defeats `java\nscript:` obfuscation), pass relative/
protocol-relative through. Rule: apply to EVERY href/src whose value
came from the database — currently 11 views do. Unit-tested.
**Risk: HIGH (security).**

### `src/lib/markdown.tsx` (162)
Safe mini-Markdown → React elements. No `dangerouslySetInnerHTML`, ever —
React auto-escaping is the XSS defense. Supports headings, quotes, lists,
tables (with status-pill cells), inline bold/code. Notably does NOT support
`---` rules or `*italics*` — which is why `guideContent.ts` strips them
when generated. Used by SOPs reader, case Notes, GuideView.
**Risk: MEDIUM (security-relevant renderer).**

### `src/lib/signoff.ts` (93)
Read-only interpreter of the server's sign-off state: stage order/labels/
tints, `SIGNOFF_ACTION_VERB` history verbs, `caseStatusTint`,
`CASE_STATUSES`, and `caseCourtHint()` ("whose court is it in" for the
case header). The chain itself is SQL — this file must never *decide*.
**Risk: MEDIUM.**

### `src/lib/forms.ts` (462)
The report-form engine's data half: 8 `FORM_SCHEMAS` (investigative
report, raid seizure, UC operation, arrest/search/wiretap warrants,
subpoena, surveillance), `REPORT_TEMPLATES` metadata, `reportTitle`,
warrant helpers (`WARRANT_TPLS`, `warrantStatusOf` — warrant lifecycle
lives INSIDE `fields._warrant_status`, not a column), `formToText`
(exports), `reportFinalizeGaps` (advisory, non-blocking), and
`REPORT_SNIPPETS` boilerplate. **Change impact**: renaming a schema field
key orphans data already saved in `reports.fields` JSON. **Risk: MEDIUM.**

### `src/lib/penal.ts` (253)
The static S.A. Penal Code: 162 charges with jail months (null = judge's
discretion), fines, flags (rico/modifier/stack/arrest). Calculators:
`penalTotals` (sums with counts), `penalSentence`, `penalSearch`,
`penalRecommend` (keyword-overlap suggestion from case text). Pure data —
edits are *legal-data* changes affecting case charges, packets, search.
**Risk: MEDIUM.**

### `src/lib/search.ts` (78)
`runSearch(q)`: ONE round trip to the `search_all` RPC (pg_trgm
typo-tolerant, RLS-scoped, capped 8/kind · 60 total) + client-side
`chargeHits` from the static penal catalog; throws so the palette can show
a real failure state. `recentSearches`/`rememberSearch` in the Store blob.
**Risk: MEDIUM** (single consumer, but it's ⌘K).

### `src/lib/notify.ts` (24) & `src/lib/notifText.ts` (71)
Write side: `notify(userId, type, payload)` → `create_notification` RPC
(server stamps the actor — cannot forge "from"), then fire-and-forget
Discord edge-function call; ALL failures swallowed (a notification must
never break the primary action). Read side: `notifTitle/notifDetail/
notifSub/notifCaseId` render every notification type — including legacy
dual keys (`case_stale`/`stale_case`, `mention`/`chat_mention`) so history
from both apps renders. **Risk: LOW-MEDIUM.**

### `src/lib/packet.ts` (208), `src/lib/pdf.tsx` (160), `src/lib/docx.ts` (99)
The export pipeline. `gatherCasePacket(c)` fans out reads (evidence,
reports, media, RICO+predicates, linked persons) with per-branch
`.catch(()=>[])` — *a partial packet is better than none*. From the same
`PacketData`: `packetDocx` (via the dependency-free OOXML writer in
docx.ts — hand-rolled ZIP with CRC32; byte-fragile, don't poke),
`packetMarkdown`, and `packetPdfSpec` → `pdf.tsx`'s `downloadPdf` which
**dynamically imports** `@react-pdf/renderer` (~0.5 MB stays out of the
main bundle) and renders the court-styled document (crest, LES
classification band, meta grid, zebra tables, signatures, watermark, page
N of M). PDF rendering needs the CSP's `wasm-unsafe-eval`. **Risk:
MEDIUM** (docx byte layout + dynamic-import boundary).

### `src/lib/watchlist.ts` (63), `src/lib/operations.ts` (49), `src/lib/fivemanage.ts` (34)
`watchlist`: zustand follow-store; `toggle` handles the double-click
unique-race (23505 → treat as already-following), `markWatchSeen` stamps
the Store blob. `operations`: zustand cache + `OPS_CASE_COLS` slim
projection + status colors. `fivemanage`: `fmUpload(file)` → multipart
POST (field keyed by kind), returns hosted URL; `fmConfigured()` gates
upload UI (falls back to paste-a-URL). **Risk: LOW-MEDIUM each.**

## 10.2 `src/app/` — routes & skeleton

### `src/app/layout.tsx` (44)
Root HTML: fonts (next/font Inter + JetBrains Mono), `noindex` metadata,
**deliberately no service worker**, and `PREF_APPLIER` — the ONE sanctioned
`dangerouslySetInnerHTML`: a static compile-time script that applies
accent/density/nav-collapsed from the Store blob *before hydration* (no
theme flash). It allow-lists values before touching the DOM.
**Risk: MEDIUM** (first paint + the hydration contract).

### `src/app/page.tsx` (59)
The `/` redirect shim with two jobs: (1) legacy deep-link continuity
(`#case=<id>` → `/cases?case=`, `#<tab>` → `/<tab>`, else last-visited tab
from Store); (2) **auth-callback safety** — if Supabase lands OAuth/magic
tokens on `/`, it waits for `onAuthStateChange` (INITIAL_SESSION/SIGNED_IN)
before redirecting so `detectSessionInUrl` can consume them. Redirecting
too early = broken sign-in. **Risk: HIGH.**

### `src/app/(app)/layout.tsx` (27) & `src/app/(app)/[tab]/page.tsx` (252)
The gate boundary (`AuthProvider` → `Gated` → `Gate`|`AppShell`, plus
`Toaster`+`DialogHost` in both states) and the 29-way switch (each view in
`<Suspense fallback={<ViewPlaceholder/>}>`; `generateStaticParams` from
PAGE_META; `reports`→`/cases`, unknown→`/command`). **Risk: HIGH / MEDIUM.**

### `src/app/error.tsx`, `global-error.tsx`, `not-found.tsx`
Route crash boundary (Try again + digest ref + hard reload to pick up new
deployments), root-layout crash fallback (inline styles — no CSS
guaranteed), styled 404. **Risk: LOW.**

### `src/app/globals.css` (230)
The design system: `@theme` ink palette (#070b14→#26385a) + badge blue;
**the accent remap** — an unlayered block rewriting `text-blue-*`/
`bg-blue-500*`/`badge-500` utilities to `rgb(var(--acc-*))` so all four
user-selectable accents flow through the same utility classes (this is why
"blue" classes render amber by default!); density via `html[data-density]`;
`.t-readout`/`.t-dot` telemetry type; `.nav-collapsed` rail rules (the
Sidebar contract); `.rich-editor-content` (Tiptap look); reduced-motion
support. **Risk: MEDIUM-HIGH** (the remap + collapse contracts are shared
with components and the pre-hydration script).

## 10.3 `src/components/shell/` — the chrome

| File | Essentials | Risk |
|---|---|---|
| `useNav.ts` (37) | `activeTab` from pathname (`isValidTab` else command), `navigate(tab)` = push + smooth scroll; `feedback` has null category (hides Subtabs). Tab persistence is NOT here (AppShell's job). | HIGH — everything navigates through it |
| `AppShell.tsx` (62) | Composes Sidebar/Header/Subtabs/BottomNav/ConnBanner around the view; persists `Store('tab')` on every route change; drawer state + body scroll lock + ≥1024px reset. | MEDIUM |
| `Header.tsx` (146) | Title/sub from PAGE_META; global keyboard entry points (Ctrl/Cmd-K palette, `/` focuses search unless typing); LOA toggle; sign out; role-caps chip. | MEDIUM-HIGH |
| `Sidebar.tsx` (191) | 5 category buttons + Feedback leaf + officer card + appearance/collapse. Collapse state lives as a **class on `<body>`** (`nav-collapsed`) read via `useSyncExternalStore` — the body class IS the store, set pre-hydration; legacy CSS renders the rail. Badges (pending/announcements/signoff) on Command only. | HIGH |
| `BottomNav.tsx` (47) | Mobile bottom bar, same categories, summed badge. | LOW-MEDIUM |
| `Subtabs.tsx` (46) | Tab strip within the category; hides `audit` unless the owner (UI mirror of RLS). | LOW |
| `SearchPalette.tsx` (251) | The ⌘K overlay: 200ms-debounced `runSearch` with a `seq` guard against out-of-order replies; quick actions (New case if canEdit, LOA, sign out, go-to-tab) share ONE keyboard selection with hits; Enter routes (`case`→`?case=`, seeded tabs→`?q=`); recent searches on empty. Portal-rendered. | HIGH |
| `NotificationsBell.tsx` (114) | 50 latest notifications, live via version counter; optimistic mark-read with rollback; row click deep-links to the case. Renders only signed-in, desktop. | MEDIUM |
| `ConnBanner.tsx` (34) | navigator.onLine via `useSyncExternalStore`; offline pill + "back online" toast. | LOW |
| `AppearanceModal.tsx` (74) | Accent (4) + density (2) → Store + `applyAppearance()` (same dataset attributes the pre-hydration script sets). | LOW-MEDIUM |
| `MyProfileModal.tsx` (80) | Self-service name/badge/LOA via `updateNoSelect` (the email-grant workaround); refreshes auth + roster. | MEDIUM |
| `useNavBadges.ts` (90) | The three Command badges: pending approvals (command only), unseen announcements (vs `annSeen` stamp), and "needs attention" (reviewable sign-offs — a client-side mirror of the routing rules — plus bounced submissions, unread mentions, overdue stale cases, due follow-ups). | HIGH — duplicated routing predicate must match the server |
| `icons.tsx` (84) | The SVG icon set + `CategoryIcon`. | LOW |

## 10.4 `src/components/ui/` — primitives

| File | Essentials | Risk |
|---|---|---|
| `Modal.tsx` (139) | THE modal: focus trap, Escape/backdrop via `requestClose` which consults `dirty()` → discard-confirm; `beforeunload` guard; **ref-counted body scroll lock** (stacked modals safe); handlers routed through refs so the effect deps are only `[open]` (AuthProvider re-renders hourly on token refresh — without this, modals would re-mount and drop focus). | HIGH |
| `dialog.tsx` (146) | Promise-based `uiConfirm`/`uiPrompt` + `DialogHost`; **capture-phase** keydown so dialog keys beat the underlying modal's Escape; danger-styled confirm; z-70 above toasts (z-60) above modals (z-50). | MEDIUM |
| `Toaster.tsx` (46) | Renders the toast store; Undo button; aria-live polite. | LOW |
| `DataTable.tsx` (153) | Generic sort/filter/paginate/CSV table; `csvCell` export guard (`'`-prefix formulas, RFC-4180 quoting) — unit-tested. Used by AuditView (adopt for future tabular screens). | MEDIUM |
| `RichEditor.tsx` (77) | Tiptap v3, markdown in/out (`tiptap-markdown`); value is INITIAL-ONLY (mount fresh per edit session); `immediatelyRender:false` for SSR; toolbar `onMouseDown preventDefault` keeps editor focus. | MEDIUM |

## 10.5 Feature views (30 files) — one paragraph each

**`cases/CasesView.tsx` (178) — HIGH.** Root of the flagship: scope
(mine/all) + view (grid/board) + filters + saved views (all
Store-persisted), text search, bulk delete, `?case=` → CaseDetail,
`?new=1` → create modal (once, then strips the param). Runs the
**stale-case auto-escalation** once per session: after 6s, CAS-stamps
`last_stale_notified_at` via `updateWhere(is:null)` and notifies
lead/bureau-leads/deputy — a lost race is silently skipped.

**`cases/CaseDetail.tsx` (839) — HIGHEST.** Case header (status select,
follow-up, pin, watch, edit, delete-with-cascade-undo, packet export) + 12
tabs, each its own mini-app: Overview (assignments/stats), Graph (dynamic
import), Evidence (auto `EV-###` codes, custody transfers via prompt →
append-only chain, linked media), Notes (RichEditor on `cases.notes`),
Charges (`cases.charges` JSON + penal search/recommend/totals), RICO
(lazy-created tracker + predicates + readiness score), Intel (polymorphic
links), Reports (schema-driven `FormEditor`, client-computed `seq`,
finalize ONLY via RPC), Tasks (sub-task capable, Enter-submit, done
toggles), Sign-off (owner submits/recalls, reviewer decides — all RPC),
Chat (mentions → `notify`, delete own/command), Timeline (aggregated
events → `TimelineBand` + list). `mutateThen` toasts previously-silent
one-click failures. Delete-case cascade config (children: assignments/
tasks/messages/history/reports; setNull: evidence/media) **must match the
FK schema**.

**`cases/CaseModal.tsx` (233) — HIGH.** Create/edit with template chips
(prefill + auto-insert checklist `case_tasks`), case-number =
`BUREAU-digits` generation, command-only lead select + Template Manager
(raw textarea per row parsed on save only). **`cases/CaseBoard.tsx` (75)
— MEDIUM.** HTML5 drag-drop between status columns; optimistic local
status mutation; stamps `closed_at`. **`cases/CaseFilterBar.tsx` (90),
`caseUtils.ts` (83), `StaleBadge` (17), `WatchButton` (27)** — filters +
saved views + pins/recents (Store keys shared with vanilla), staleness
(open/active ≥14 days), follow toggle. **`cases/CaseGraphTab.tsx` (579) —
HIGH** and **`cases/TimelineBand.tsx` (236) — MEDIUM** are documented in
§11.4/§11.5.

**`command/CommandView.tsx` (353) — HIGH.** The dashboard orchestrator:
KPI cards (click = drill filter), command filter bar + bureau scorecards
(command-gated; bureau lead sees own bureau only), matching-case drill,
plus 8 child widgets — `Analytics` (pure props → tiles + single-hue bars),
`ActivityFeed` (last 12 audit rows, live), `AttentionWidget` (stale/
no-lead/stuck-in-signoff; its "all →" jump forces `casesScope='all'` so
the default *mine* scope can't empty the list), `JumpBack`
(pins/recents), `Encourage` (rotating banner, session dismiss),
`TicketQueue` (288 — intake + 3-step wizard that CREATES A CASE and
routes/renames tickets; duplicate case number surfaced from the DB error),
`Trackers` (220 — dual co-sign GPS authorizations: deploy → pending,
second command member co-signs → authorized + expiry; self-co-sign
blocked in UI AND by trigger; a 1s tick flips expired trackers — only
command clients attempt the write, guarded by a ref), `RaidComp` (93 —
pure calculator, never saved), `commandUtils.ts` (103 — filter matcher,
bureau scoring, ticket routing tables, raid brackets).

**Intel registries** — same skeleton (fetch + version counter, `?q=` seed,
card grid, modal CRUD, canEdit/canDelete gates, deleteWithUndo):
`persons/PersonsView` (314, MEDIUM — bulk delete with
`PERSON_NULL_REFS` restore, attach-to-case posts a chat reference,
quick-add from empty search) + `PersonModal` (163 — repeatable
properties JSON; **gang-preservation synthetic option** so a stale cache
can't null the FK) + `IntelProfile` (371, HIGH — the person/gang
slide-over rolling up everything; `seqRef` guards overlapping loads,
`gangsRef` prevents blanking on parent refetch; restricted cases render as
stubs; dossier export docx/pdf) + `dossier.ts` (193 — the gather/format
half; warrant matching by subject-name heuristic);
`gangs/GangsView` (693, HIGH — list/detail/roster-by-rank/turf/properties;
bulk delete with children gang_members/ranks/turf + setNull
persons.gang_id); `vehicles/VehiclesView` (385, MEDIUM-HIGH — plate
registry + the **cross-reference scanner**: phones `(###) ###-####`,
plate word-boundary hits, persons in 2+ cases; scan failure shows Retry,
NEVER a false "no matches"); `bolo/BoloView` (221, MEDIUM — persons with
`bolo=true` + warrant chip via lowercased subject-name join — heuristic,
collisions possible); `places/PlacesView` (430, MEDIUM-HIGH — generated
lab recipes from precursors, custom `place_process_steps` override,
children restored on undo); `narcotics/NarcoticsView` (366, MEDIUM-HIGH —
what-if purity sliders client-only; **delete-then-reinsert children with
full error checking + best-effort restore** — the fixed data-loss bug);
`indicators/IndicatorsView` (338, MEDIUM — `matchKey` normalization IS
deconfliction: separators stripped for phone/account/serial); `network/
NetworkView` (235, MEDIUM — hand-rolled SVG ego graph, drag/wheel in
refs + native non-passive listener); `ballistics/BallisticsView` (362,
LOW-MEDIUM — benches by street/organized with Store-persisted tab,
newline-split arrays); `media/MediaView` (396, MEDIUM — tags are a JSON
shape `{location, person, labels[]}`; audio has no enum value — detected
by extension); `modus/ModusView` (261, MEDIUM-HIGH — MO_DICT substring
scan + `mo_crossref` RPC: a **deliberate, existence-only cross-bureau
leak** with request-access flow; the visible/locked partition must not
regress); `records/RecordsView` (270, MEDIUM — the canonical
**zero-rows-no-error = RLS-blocked** check, surfaced as a warning).

**Oversight & reference** — `inbox/InboxView` (373, HIGH — ten derived
panels off eight live tables; mention detection scans `mentions` JSON +
`@displayName`; `seenVer` manually invalidates the Store-read watchSeen
map inside the memo); `calendar/CalendarView` (186, LOW-MEDIUM — month
seeded in an effect for deterministic prerender; Monday-first grid);
`shifts/ShiftsView` (208, MEDIUM — one report per week enforced by unique
key, duplicate surfaced as "edit it instead"; auto-rollup of own cases +
evidence); `audit/AuditView` (106, LOW — owner-only, DataTable, NOT
live); `sops/SopsView` (246, MEDIUM — command-only writes; **snapshots to
`documents_versions` BEFORE overwrite**; gdrive-synced docs flagged);
`penal/PenalView` (53, LOW — static); `guide/GuideView` (406, LOW — the
visual guide; nav map data-driven but the illustrated case-tab rail is
hardcoded and CAN drift); `feedback/FeedbackView` (179, LOW — owner
triage vs member withdraw; not live); `announce/AnnounceView` (241,
MEDIUM — pinned-first; per-user dismissal local-only; stamps `annSeen`
for the badge — quirk: the stamp is the first *visible* item) +
`AnnouncementModal` (181 — fan-out `notify` ONLY on first post, never on
edit) + `announceUtils` (58); `analytics/AnalyticsView` (269, MEDIUM —
Monday-week buckets stamped by `loadedAt`; "closed" ≈ `updated_at`);
`heatmap/HeatmapView` (458, HIGH — dual-window aggregation + weighted
layers + the pan/zoom SVG map with functional-setState wheel math;
`HM_XY` hardcodes area coordinates); `casefiles/CaseFilesView` (221,
MEDIUM — FiveManage upload; **`drive_file_id` (legacy NOT NULL column) is
set to the file URL** — the fix for the upload bug); `personnel/*`
(PersonnelView 183, AdminPanel 106, AssignModal 125 MEDIUM-HIGH — role/
bureau/active ONLY via `assign_member` RPC, name/LOA via plain update,
permanent removal via RPC with self-removal blocked; Commendations 143);
`rico/RicoView` (110, MEDIUM — imports `RicoTab` from inside CaseDetail —
an internal cross-import to know about); `operations/OperationsView`
(137, MEDIUM); `auth/Gate.tsx` (145, MEDIUM — one branch per auth state);
`ViewPlaceholder` (24, LOW).

---

# 11. Features & User Flows

Each flow lists every file touched, in order, with the failure points.

## 11.1 Sign-in

`/` (`app/page.tsx`) → `Gate.tsx` → Supabase Auth (OAuth redirect or magic
link) → back to `/` where `page.tsx` WAITS for the auth event before
redirecting → `auth.tsx` `evaluate()` → `profiles` fetch → state
`in`/`pending`/`error` → `(app)/layout.tsx` swaps Gate for AppShell.
**Failure points**: profile fetch fails → "error" screen with Retry (not a
fake pending); profile inactive → pending screen (approval flow, §11.8);
redirecting before the token is consumed (don't touch page.tsx's wait).

## 11.2 The life of a case (the flagship flow)

1. **Create** — `CasesView` "+ New Case" (or ⌘K "new case", or the
   TicketQueue wizard) → `CaseModal`: template chip prefills + checklist;
   `insert('cases')` with `case_number = BUREAU-digits`; template tasks
   `insert('case_tasks')`. RLS: `can_create_case(bureau)`. Duplicate case
   number → humanized toast. Realtime bumps every open board.
2. **Work it** — `CaseDetail` tabs write evidence/reports/tasks/messages/
   links (all case-scoped RLS). Custody transfers append `custody_chain`.
   Charges live as JSON on the case; totals from `penal.ts`.
3. **Board moves** — drag on `CaseBoard` → `update('cases', {status})`
   (+`closed_at` stamp via trigger as well). `set_case_closed_at` and
   `touch_cases` triggers stamp server-side truth.
4. **Stale escalation** (automatic) — `CasesView` once per session finds
   open/active cases ≥14 days quiet, CAS-claims them (`updateWhere`
   `last_stale_notified_at is null`), notifies lead + bureau leads +
   deputy. The CAS means two open tabs can't double-notify.
5. **Sign-off** — CaseDetail Sign-off tab → `rpc('signoff_submit')`;
   `private.signoff_route/pick` choose the stage + a non-LOA assignee;
   reviewer acts via `rpc('signoff_decide')` (approve/deny/changes),
   owner via `rpc('signoff_owner_action')`. Every action appends
   `case_signoff_history` + `notify()`. Direct column writes are
   trigger-blocked. UI vocabulary: `lib/signoff.ts`; badge mirror:
   `useNavBadges.canReviewCase`.
6. **Export** — PacketButton → `gatherCasePacket` → DOCX/MD/PDF (§10.1
   packet/pdf/docx). Failure of any sub-read yields a partial packet.
7. **Delete** — command only; `deleteWithUndo` with the cascade config;
   Undo restores parents+children with original ids.

## 11.3 Global search & commands (⌘K)

`Header` (shortcut) → `SearchPalette` → 200ms debounce → `runSearch` →
`search_all` RPC (RLS-scoped, typo-tolerant) + static penal hits →
sectioned list; quick actions (New case, LOA, sign out, go-to) share the
selection model. `seq` guard drops out-of-order replies. Enter routes to
`?case=`/`?q=` deep links (§9). **Failure**: RPC error → explicit error
state (throws by design).

## 11.4 Investigation graph (case link chart)

`CaseDetail` Graph tab → dynamic import of `CaseGraphTab` (React Flow) →
fetch links/persons/gangs/places/vehicles/evidence/reports → radial layout
(case pinned center; vehicles ring; expanded persons' other cases outer
ring) → node click = side panel with deep links; canEdit: 🔗 link intel
(insert `case_intel_links`), Unlink (delete), person "Show their other
cases" (RLS-scoped `in` query). Dragged positions persist per case+device
(`Store graphLayout:<caseId>`), reset button clears.

## 11.5 Timeline chronology

Timeline tab aggregates evidence/reports/tasks/sign-off history + opened/
follow-up into `BandEvent[]` → `TimelineBand` (fixed-viewBox SVG; zoom
remaps time→x so nothing distorts; wheel is a native non-passive listener
with math inside functional setState) + the list below.

## 11.6 Uploads (attachments & media vault)

`CaseFilesView`/`MediaView` → `fmConfigured()` gate → file picker →
`fmUpload` (multipart to FiveManage, returns URL) → `insert('case_files')`
(with `drive_file_id = url` — legacy NOT NULL column) or `insert('media')`
(typed + tag JSON). Preview/lightbox render by MIME/extension through
`safeUrl`. **Failure**: handled per file — each upload toasts independently; missing config shows a
banner and paste-a-URL fallback (media only).

## 11.7 Notifications

Producers: chat mentions, sign-off actions, tracker events, announcements
(first post only), member approval, stale escalation, M.O. access requests
— ALL through `notify()` → `create_notification` RPC (actor stamped
server-side) → optional Discord DM (fire-and-forget). Consumers:
`NotificationsBell` (live, optimistic mark-read) and `InboxView` panels.
Rendering vocabulary: `notifText.ts` (handles legacy type aliases).

## 11.8 Roster & approval

New sign-in → trigger creates inactive profile → Command sees the pending
badge (`useNavBadges`) → `PersonnelView`/`AdminPanel` approve via
`assign_member` RPC → member becomes active; `notify('member_approved')`.
Role/bureau changes: `AssignModal` → same RPC (guard trigger blocks direct
writes). Removal: `admin_remove_member` (soft, `removed_at`), restore via
`admin_restore_member` (returns inactive → re-approval).

## 11.9 Watchlist ("follow")

`WatchButton` on cases/persons/vehicles → `useWatchlistStore.toggle` →
insert/delete own `watchlist` row; "seen" stamps in the Store blob;
`InboxView` Following panel computes `updated` chips (target `updated_at`
vs stamp), mark-seen on open / mark-all.

## 11.10 Deconfliction (two independent systems)

1. **Vehicles scanner** (client heuristics): phones/plates/persons across
   ≥2 visible cases from reports text + intel links; failure shows Retry —
   never a silent "no matches".
2. **Indicators registry** (server data): normalized `matchKey` over the
   shared `indicators` table; matches into inaccessible cases render 🔒
   restricted stubs (value visible, case hidden — deliberate).
Plus **M.O. crossref** (RPC, existence-only leak + request-access flow).

---

# 12. State Management

The app deliberately has NO general global state library usage for data.
The layers, from narrowest to widest:

| Layer | What lives there | Files |
|---|---|---|
| **Component state** (`useState`) | Everything screen-local: fetched rows, filters, modal open/close, form fields. Modals mount fresh per open (state seeds from props — no reset effects). | every view |
| **Derived state** (`useMemo`) | Filtering, grouping, chart buckets, graph building. Heavy memos are deliberate (InboxView's model, HeatmapView's rows, CaseGraphTab's graph). | big views |
| **React Context** | Exactly one: `AuthProvider` (session/profile/capabilities). | `lib/auth.tsx` |
| **zustand stores** | Cross-cutting singletons: toasts, dialogs, realtime versions, profiles cache, operations cache, watchlist. Chosen over context because non-React code (db.ts, notify) must push toasts. | `lib/{toast,realtime,profiles,operations,watchlist}.ts`, `ui/dialog.tsx` |
| **localStorage** (`Store`) | Device preferences + continuity with the legacy app (one JSON blob, §10.1). NOT for data. | `lib/store.ts` |
| **The database** | ALL shared data. There is no client-side data cache layer (react-query is installed but unused) — every screen refetches on mount and on realtime version bumps. | Supabase |

**The refresh idiom** (memorize — it's in ~30 files):

```tsx
const version = useTableVersion('cases')          // realtime counter
const refresh = useCallback(async () => { ... }, [state])
useEffect(() => {
  const t = setTimeout(() => { void refresh() }, 0)  // deferred: lint-clean,
  return () => clearTimeout(t)                       // deterministic prerender
}, [refresh, version])
```

A realtime event → channel handler → `bump(table)` → every subscribed
view's `version` changes → effect refires → refetch. Simple, no caches to
invalidate, at the cost of refetching whole tables (§18).

**Async races** are handled with sequence guards (`seq`/`seqRef` counters
in SearchPalette, IntelProfile; `cancelled` flags in the vehicles scanner)
— only the newest request's result lands.

---

# 13. Forms

There is no form library (react-hook-form is installed but unused). Two
form styles exist:

1. **Ad-hoc modals** (the norm): controlled `useState` per field, `save()`
   validates required fields with warn toasts, mutation helpers return
   `{error}` → danger toast, success → toast + close + refresh. `dirty()`
   feeds the Modal discard-guard. Validation is intentionally light —
   the DB enforces the real constraints (NOT NULL, checks, uniqueness) and
   `humanizeError` translates violations.
2. **The schema-driven report engine**: `FORM_SCHEMAS` (`lib/forms.ts`)
   describe sections (kv/grid/textarea/note) and `FormEditor` inside
   CaseDetail renders any of them generically. Values live in
   `reports.fields` JSON. Finalization: `reportFinalizeGaps` warns about
   missing critical fields but does NOT block; `report_finalize` RPC
   stamps signature/badge and locks (trigger-enforced).

Notable per-form quirks: CaseModal's case-number builder + template
checklist; ShiftsView's Monday-keyed uniqueness ("edit it instead" on
23505); TicketWizard's 3 steps with dept re-routing; AssignModal's split
writes (RPC for privileges, plain update for cosmetics); IndicatorModal /
PersonModal / PlaceModal / VehicleModal FK-preservation synthetic options.

---

# 14. Environment Variables

| Variable | Purpose | Used in | Required | What breaks if changed/wrong |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | The Supabase project's API base URL | `lib/supabase.ts` | Yes | Everything: app renders the "setup" gate |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The publishable client key (safe to expose; RLS is the boundary) | `lib/supabase.ts` | Yes | Same — setup gate; wrong key = auth failures |
| `NEXT_PUBLIC_FIVEMANAGE_API_KEY` | Upload key for FiveManage (public-by-design, referrer-bound) | `lib/fivemanage.ts` | No | Uploads disabled; views show a config banner + paste-URL fallback |
| `NEXT_PUBLIC_FIVEMANAGE_BASE_URL` | FiveManage API host | `lib/fivemanage.ts` | No | Uploads fail |

All four are committed in `vercel.json` (build env) and mirrored in
`.github/workflows/ci.yml` — they are client-side public values.
**There are no secret env vars in this repo.** The `service_role` key
exists only in Supabase's own dashboard and must never enter the codebase.
`NEXT_PUBLIC_` prefix means Next.js inlines the value into the browser
bundle at build time — changing one requires a rebuild, not just a
redeploy.

---

# 15. External Services

| Service | Purpose | Integration | Files | Data exchanged |
|---|---|---|---|---|
| **Supabase** | Database, auth, auto-REST API, realtime | `@supabase/supabase-js` over HTTPS/WSS | `lib/supabase.ts` → everything | All application data + JWTs |
| **FiveManage** | Image/video/audio/PDF hosting | multipart POST | `lib/fivemanage.ts`, CaseFilesView, MediaView | Uploaded files out; hosted URLs back (only URLs stored in DB) |
| **Discord** | (a) OAuth sign-in provider; (b) optional DM notifications via a Supabase edge function (`discord-notify`) invoked fire-and-forget | Supabase Auth config; `invokeFunction` | `lib/auth.tsx`, `lib/notify.ts` | OAuth identity; notification text |
| **Vercel** | Hosting, previews, instant rollback | git-push driven | `vercel.json` | The built site |
| **GitHub Actions** | CI gates | `.github/workflows/ci.yml` | — | build/test results |

CSP `connect-src` allow-lists exactly these hosts — adding a new external
service REQUIRES a next.config.ts change or it will be silently blocked.

---

# 16. Deployment

- **Build**: `next build` type-checks, lints (via CI separately), and
  pre-renders all 29 tab routes + `/` + error pages as static HTML. No
  server functions are emitted — the output is effectively a static site.
- **Hosting**: Vercel project `cid`. Production tracks `main`: every merge
  builds and atomically flips the production alias. Every PR gets an
  immutable preview URL (the Vercel bot comments Building→Ready on PRs).
- **Rollback**: Vercel "Instant Rollback" repoints production to any
  previous immutable deployment in seconds (the blue-green equivalent).
  Because DB migrations are additive-only, an app rollback never requires
  a schema rollback.
- **Environment**: the four public values come from `vercel.json`'s
  build env (previews inherit them; production has them as project env).
- **Risks**: (1) schema/app version skew — an old bundle in an open tab
  keeps querying; additive-only migrations + `select` projections keep it
  safe; (2) CSP edits ship globally with the next deploy — test PDF
  export and realtime after touching them; (3) `guideContent.ts` is
  generated — editing `docs/USER-GUIDE.md` without regenerating drifts the
  in-app guide.

---

# 17. Testing & CI

- **Unit tests** (vitest, `npm test`): 3 files / 10 tests pinning the
  security-critical pure functions — `safeUrl` (XSS scheme allow-list),
  `csvCell` (CSV formula-injection guard), `format` helpers. Config:
  `vitest.config.ts` (node env, `@` alias, `src/**/*.test.ts`).
- **CI** (`.github/workflows/ci.yml`): every push/PR runs
  `tsc --noEmit` → `eslint src --max-warnings 0` → `vitest run` →
  `next build` on Node 22. The same four gates are the local
  pre-commit ritual. No secrets in CI (public client keys only).
- **What is NOT covered**: component behavior, RLS policies, RPC logic,
  realtime — all currently verified manually. §23 has recommendations.

---

# 18. Performance Review

**What's already good**: static pre-rendering (instant first paint);
dynamic imports keep React Flow + @react-pdf out of the main bundle;
68 FK covering indexes + pg_trgm indexes server-side; single-channel-per-
table realtime; memoized heavy derivations; `select` projections for
picker queries.

**Real findings, in priority order:**

1. **Full-table refetch on every change** — the version-counter pattern
   refetches ENTIRE tables (e.g. all cases) on any single row change, per
   subscribed view. Fine at division scale (hundreds of rows); will not
   scale to tens of thousands. Mitigations exist in `DEFERRED.md`
   (server-side pagination) — revisit when case count grows 10×.
2. **`list('reports')`/`list('case_messages')` blobs in scanners** — the
   vehicles cross-ref scanner and InboxView mention scan pull broad tables
   and regex/JSON-scan client-side. Bounded today (limits on messages),
   but the scanner is O(vehicles × cases) with regexes.
3. **Large single files** — CaseDetail.tsx (839 lines, 12 tabs in one
   file) and GangsView (693) are edit-risk hotspots more than runtime
   problems (each tab lazy-fetches its own data).
4. **Unnecessary re-renders** — the 1-second tick in `Trackers` re-renders
   the whole widget every second while visible (fine, it's small);
   AuthProvider re-renders hourly on token refresh (mitigated by Modal's
   ref-routing — a known interaction).
5. **No image optimization** — external mugshots/media use plain `<img>`
   (next/image can't optimize arbitrary remote hosts without config);
   acceptable, but large images render full-size in cards.
6. **Subscription hygiene is GOOD** — channels are opened once per table
   per session and torn down on sign-out; no leak pattern found.
7. **Missing realtime on a few tables** (audit feed exception: it IS
   published; `feedback`/`watchlist`/`operations` are not) — those screens
   refresh only on remount; deliberate but worth knowing.

---

# 19. UX Review

**Strengths**: consistent loading/error/empty triad everywhere; every
destructive action confirms AND offers 6s Undo; dirty-guards on all modals
(+ beforeunload); offline banner + reconnect toast; keyboard entry (`/`,
`Ctrl-K`, arrows/Enter in palette, Enter-submit in quick adds); deep links
for every entity; focus-trapped modals with focus restore; aria-sort,
aria-live on toasts, alt-text fallbacks on mugshots; reduced-motion
support; mobile bottom nav + drawer + keyboard re-centering; per-user
appearance (accent/density) applied pre-hydration (no flash).

**Gaps worth fixing** (also in §23):

- **Color-only signals** in a few spots (heat tint on tiles) — usually
  paired with numbers, but not always labeled.
- **Tables on mobile** — AuditView/DataTable scroll horizontally; fine,
  but filters can crowd on small screens.
- **The board has no keyboard drag alternative** — status changes require
  the detail view's select for keyboard users (works, but two steps).
- **A few long screens lack section anchors** (CommandView) — scrolling
  cost on mobile.
- **Error digests** (error.tsx) are user-meaningless — good for support,
  could add "copy details" affordance.

---

# 20. Security Review

The model, restated: **anon key is public; RLS is the wall; SECURITY
DEFINER RPCs are the doors; triggers are the locks on specific columns.**

**Verified strong:**
- RLS on all 47 tables; deny-all on `app_secrets`; owner-only audit log.
- All five previously anon-callable RPCs revoked from `anon`/PUBLIC
  (July 2026); verified ACLs list only `authenticated`+`service_role`.
- No secrets in the repo (anon + FiveManage keys are public-by-design).
- XSS: React auto-escaping; ONE static sanctioned `dangerouslySetInnerHTML`
  (pref applier, no user data); `safeUrl` on all DB-sourced hrefs/srcs
  (unit-tested); markdown renderer builds elements, never HTML strings.
- CSV exports formula-injection-guarded (unit-tested).
- CSP: `default-src 'self'`, no remote script origins, `frame-ancestors
  'none'`, connect-src allow-list; `wasm-unsafe-eval` (not full
  unsafe-eval) only for PDF WASM. `unsafe-inline` for styles/scripts
  remains (Next.js inline runtime) — standard, but nonce-based CSP would
  be stronger (§23).
- Author/actor forgery prevented server-side (stamp triggers + RPC).
- Self-co-sign and self-role-escalation blocked by triggers.
- Uploads: client sends to FiveManage directly; the DB stores URLs only;
  rendering passes `safeUrl` and MIME-typed players. Note: FiveManage key
  allows anyone with the bundle to upload to the account (accepted,
  referrer-bound; the DB row still requires an authenticated insert).

**Residual risks / accepted trade-offs:**
1. `authenticated`-callable SECURITY DEFINER RPCs rely on INTERNAL checks
   (`assign_member` verifies command inside). A bug inside one = privilege
   escalation. They're few and small — review any edit carefully.
2. `mo_crossref` is a deliberate cross-bureau existence leak (design).
3. Client badge logic (`useNavBadges.canReviewCase`) mirrors server
   routing — a mismatch misleads (not a breach; server still refuses).
4. Rate limiting is Supabase's platform defaults (auth endpoints); no
   per-user app-level throttle. Accepted at this scale.
5. `bootstrap_command`/`bootstrap_director` RPCs still exist from setup —
   they should be dropped or verified inert (§23).
6. Magic-link/OTP expiry and leaked-password protection are dashboard
   settings (documented in `HARDENING.md` as owner actions).

---

# 21. Dependency Map

## Runtime layers

```
        ┌────────────────────────── Browser ──────────────────────────┐
        │                                                              │
        │  app/(app)/[tab]/page.tsx ── 29 feature views                │
        │        │                        │                            │
        │   shell/* (chrome)          ui/* (Modal, DataTable, …)       │
        │        │                        │                            │
        │        └────────┬───────────────┘                            │
        │                 ▼                                            │
        │   lib/auth ── lib/profiles ── lib/nav ── lib/toast           │
        │       │                                                      │
        │   lib/db  ◄── lib/{watchlist,operations,search,notify,…}     │
        │       │            lib/realtime (wss)                        │
        │       ▼                 │                                    │
        │  lib/supabase ──────────┘                                    │
        └────────┼──────────────────────────────────────┼─────────────┘
                 ▼ HTTPS (REST + RPC)                    ▼ multipart
        ┌─────────────────────────┐             ┌─────────────┐
        │ Supabase                │             │ FiveManage  │
        │  Auth ─ profiles trigger│             └─────────────┘
        │  PostgREST ─ RLS ─ 47 t │
        │  RPCs ─ private.* fns   │
        │  Realtime publication   │──► edge fn ──► Discord DM
        │  audit/touch triggers   │
        └─────────────────────────┘
```

## Who imports whom (the load-bearing edges)

- `lib/db` ← 44 components + 6 libs (the fattest edge in the repo).
- `lib/auth` ← ~40 files; `lib/profiles` ← ~24; `lib/format` ← ~25.
- `components/persons/{IntelProfile,PersonModal}` ← persons, bolo, gangs,
  network (intel views share the profile slide-over).
- `components/cases/CaseDetail` ← CasesView AND RicoView (RicoView imports
  `RicoTab` from *inside* CaseDetail — an internal cross-import).
- `lib/forms` ← CaseDetail, BoloView, CaseGraphTab, dossier, packet.
- `guideContent.ts` ← generated FROM `docs/USER-GUIDE.md` (build-time
  authorship dependency, not an import).

---

# 22. Change Impact Guide

| If I change… | Also check… | Why |
|---|---|---|
| A table's schema (live migration) | `database.types.ts` (hand-add), `select` projection strings (`grep` the column), RLS policies, realtime publication, FK index, affected views' payload builders | Types don't auto-regen; projections fail at runtime; new tables are invisible without policies & stale without publication |
| `PAGE_META` / adding a screen | `NAV_CATEGORIES` tabs, `TAB_LABEL`, the `[tab]/page.tsx` switch, GuideView's nav map (auto) + USER-GUIDE.md screen count, `guideContent.ts` regeneration | The three-way nav contract + docs |
| `lib/db.ts` contract | EVERY view's read try/catch and write `res.error` checks | The throw-vs-return split is assumed app-wide |
| `useAuth` shape / capability booleans | All ~40 consumers, Gate branches, RLS expectations | canEdit/canDelete gate every button |
| An RLS policy or `private.*` helper | The matching UI gate (buttons), `useNavBadges.canReviewCase` (sign-off mirror), silent-failure surfacing (zero-rows checks) | UI mirrors must match or users see phantom buttons/badges |
| Sign-off RPCs / routing | `lib/signoff.ts` labels, CaseDetail Sign-off tab actions, `useNavBadges`, `notifText` types | Vocabulary + mirror + notifications all track the server states |
| `FORM_SCHEMAS` field keys | Saved `reports.fields` data (old reports must still render!), `formToText`, dossier/packet warrant matching | Field keys are the storage format |
| `cases` cascade children (FKs) | `CaseDetail` delete config, `GangsView`/`PlacesView`/`PersonsView` deleteWithUndo children/setNullRefs | Undo restores exactly what the config lists |
| `Store` keys | The legacy vanilla app's reads, `page.tsx` deep-link shim, pre-hydration `PREF_APPLIER` | Shared blob = cross-app contract |
| `globals.css` accent remap / `.nav-collapsed` | Sidebar collapse logic, `PREF_APPLIER`, AppearanceModal | The class/dataset contracts live in three places |
| CSP (`next.config.ts`) | PDF export (WASM), Supabase REST+WSS, FiveManage uploads, Discord | connect-src/script-src allow-lists are exact |
| `docs/USER-GUIDE.md` | Regenerate `guideContent.ts` (strip title/rules/italics transform) | Dual-copy system |
| `matchKey` (indicators) / scanner regexes (vehicles) | Deconfliction alert correctness both ways (false + missed) | These ARE the feature |
| Env values | `vercel.json` AND `ci.yml` (duplicated) | Two copies must agree |

---

# 23. Suggestions

Recommendations only — none implemented. Ordered by value.

1. **Commit the SQL schema to the repo** (dump `schema.sql` + a
   `migrations/` log). *Why*: today the live DB is the only source of
   truth; a mistake there has no reviewable history. Difficulty: low.
   Risk: none. Effort: 1–2h + habit. Benefit: HIGH (auditability,
   onboarding, disaster recovery).
2. **Drop unused dependencies** (`react-hook-form`, `zod`,
   `@tanstack/react-query`) or adopt them deliberately. *Why*: 3 deps of
   install/audit surface with zero imports. Difficulty: trivial. Risk:
   none. Effort: 15m. Benefit: medium (hygiene, honest package.json).
3. **Split CaseDetail.tsx** into per-tab files (it's 839 lines and the
   RicoTab cross-import from RicoView is a smell). Difficulty: medium
   (pure mechanical extraction). Risk: low with the existing gates.
   Effort: 0.5–1d. Benefit: high (edit safety on the hottest file).
4. **Add RLS/RPC tests** (pgTAP or a vitest suite hitting a Supabase
   branch with two test users). *Why*: the security wall has zero
   automated coverage; §20 risk #1. Difficulty: medium. Effort: 1–2d.
   Benefit: HIGH.
5. **Drop `bootstrap_command`/`bootstrap_director`** RPCs (or verify they
   no-op). Difficulty: trivial migration. Benefit: closes a setup-era
   privileged path.
6. **Automate `guideContent.ts` generation** (a script + CI check instead
   of the manual transform). Effort: 1h. Benefit: medium (kills a drift
   class; the guide's hardcoded case-tab rail already drifted once).
7. **Extract the shared registry-view skeleton** (fetch+version+filter+
   modal+undo appears ~10×). A `useRegistry(table, opts)` hook would cut
   hundreds of duplicated lines. Difficulty: medium. Risk: medium (touches
   many screens — do it incrementally). Benefit: medium-high.
8. **Type the JSON columns** (`reports.fields`, `media.tags`,
   `cases.charges`, `announcements.mentions/links`) with zod schemas at
   the read boundary — zod is already installed. Benefit: medium
   (today's `as unknown as` casts hide shape drift).
9. **Server-side pagination for cases/audit** when data grows (tracked in
   DEFERRED.md). Not needed yet.
10. **Nonce-based CSP** (drop `unsafe-inline` for scripts). Difficulty:
    medium with Next 16. Benefit: medium (defense in depth).
11. **Add `notifications` mark-all + per-type mute prefs**; **a11y pass on
    color-only heat tints**; **DataTable adoption for RecordsView-style
    lists** — smaller UX wins, low risk each.

---

# 24. Dead Code Review

| Item | Evidence | Recommendation |
|---|---|---|
| `lib/drafts.ts` | Zero importers in `src/` (grep-verified) — the "never-lose-work" util was ported but never wired | Wire into chat/report editors (it's good!) or delete |
| `react-hook-form`, `zod`, `@tanstack/react-query` | In package.json, zero imports | Remove or adopt (see §23-2/8) |
| `bootstrap_command` / `bootstrap_director` RPCs | Live in DB, no app callers | Drop via migration after verifying inert |
| `chargeByCode` in penal.ts | Back-compat alias of `penalByCode` | Fold into one on next touch |
| `roles.isCommand` | `@deprecated` alias (role-only, ignores `active`) | Migrate remaining callers to `meIsCommand`/auth booleans |
| `ViewPlaceholder` | Only reachable if a PAGE_META tab is missing from the `[tab]` switch — currently none | Keep (cheap safety net) |
| GuideView's illustrated case-tab rail | Hardcoded list drifts from CaseDetail's real TABS (already omits Notes, shows "Files") | Data-drive it or fix the copy |
| `docs/{HANDOFF,PHASE2-HANDOFF,ROADMAP,REACT-PARITY,BACKLOG,DEFERRED}.md` | Historical build-era docs; REACT-PARITY/BACKLOG partly stale post-cutover | Mark as historical or archive into `docs/history/` |
| Root-level legacy `*.js` vanilla app files | Frozen, eslint-ignored (the pre-React site) | Keep until the vanilla site is fully retired, then delete a whole era |

No unused components or unreachable screens were found in `src/` — the
`[tab]` switch covers every PAGE_META entry.

---

# 25. Learning Order

1. **This handbook §1–§7** — the mental model (DB-is-authority) reframes
   everything else. Then skim `docs/USER-GUIDE.md` AS A USER.
2. **`lib/supabase.ts` → `lib/db.ts` → `lib/auth.tsx`** (~450 lines
   total) — after these, every view's first 30 lines read themselves.
3. **One simple registry view**: `vehicles/VehiclesView.tsx` — the full
   idiom (fetch+retry, version counter, ?q= seed, modal CRUD, undo,
   FK-preservation) in one self-contained file. Then diff it against
   `IndicatorsView` to see how uniform the pattern is.
4. **The shell**: `useNav` → `AppShell` → `Sidebar` → `SearchPalette` —
   how a URL becomes a screen and how ⌘K routes.
5. **`lib/realtime.ts` + the refresh idiom** (§12) — now the "live"
   magic is demystified.
6. **`CasesView` → `CaseModal` → `CaseDetail` one tab at a time**
   (Overview → Tasks → Evidence → Reports → Sign-off last). Read
   `lib/signoff.ts` and §8.3's RPC table alongside the Sign-off tab.
7. **The database** (§8) with the Supabase dashboard open — read the
   policies of `cases` and `case_intel_links` for real.
8. **Specialists last**: CaseGraphTab, HeatmapView, InboxView, packet/
   pdf/docx — intricate but leaf-node; nothing else depends on them.

Each step depends only on the previous ones; a newcomer is productive on
registry-view tickets after step 3 and on case features after step 6.

---

# 26. Final Summary

**Most important files** (understand before anything else):
`lib/db.ts`, `lib/auth.tsx`, `lib/realtime.ts`, `lib/nav.ts`,
`app/(app)/[tab]/page.tsx`, `cases/CaseDetail.tsx`.

**Most important folder**: `src/lib/` — 25 files that define every
contract the 27 feature folders obey.

**Highest-risk files to edit**: `CaseDetail.tsx` (size × centrality),
`lib/db.ts` (error contract), `lib/auth.tsx` (gate), `globals.css`
(accent remap + collapse contracts), `next.config.ts` (CSP),
`database.types.ts` (schema mirror), `useNavBadges.ts` (server-mirroring
logic), and — outside the repo — the RLS policies and SECURITY DEFINER
functions themselves.

**Hidden dependencies that bite**:
1. The Store blob keys are shared with the legacy vanilla site.
2. `guideContent.ts` is generated from `docs/USER-GUIDE.md`.
3. `RicoView` imports a component from inside `CaseDetail.tsx`.
4. `case_files` keys by case *number* (text), not id.
5. Warrant status lives inside `reports.fields._warrant_status`.
6. `drive_file_id` = FiveManage URL (legacy NOT NULL column).
7. The accent system remaps blue-* Tailwind utilities in globals.css.
8. `vercel.json` and `ci.yml` duplicate the env values.
9. `useNavBadges`/`caseCourtHint` mirror server sign-off routing.
10. Modal's effect-deps-[open] + refs design exists BECAUSE AuthProvider
    re-renders on hourly token refresh.

**Biggest technical debt**: no schema/migrations in the repo; no RLS/RPC
test coverage; CaseDetail's size; three unused dependencies; the
duplicated registry-view skeleton.

**Safest places for a beginner**: PenalView, ViewPlaceholder, GuideView,
Toaster/StaleBadge/WatchButton, then any registry view. **Do not touch
without full understanding**: sign-off (SQL + RPCs + mirrors), delete
cascade configs, the auth state machine, CSP, the accent remap,
`matchKey`/scanner heuristics.

**Top 20 concepts to understand before editing this project:**
1. Row Level Security and why the client is "dumb"
2. The anon key being public by design
3. `list` throws / mutations return `{error}` (the db.ts contract)
4. Zero-rows-no-error = RLS-blocked write (the silent-failure trap)
5. SECURITY DEFINER RPCs as the only path for privileged flows
6. Guard triggers (columns even allowed writers can't touch)
7. The realtime version-counter refresh idiom
8. The deferred-`setTimeout(0)` effect pattern (and why)
9. `deleteWithUndo` + cascade snapshot config
10. `withRetry` reads-only rule (mutations never auto-repeat)
11. The auth state machine and capability booleans being UX-only
12. The `PROFILE_COLS`/email column-grant workaround
13. The nav three-way contract (PAGE_META/categories/labels/switch)
14. Modals mount fresh per open; `dirty()` guards; ref-routed handlers
15. `safeUrl` on every DB-sourced href/src; no innerHTML ever
16. The Store blob and its legacy-shared keys
17. Hand-maintained `database.types.ts` moving with migrations
18. Additive-only migrations (deployed bundles keep old queries)
19. Sequence guards for async races (`seq`, `cancelled`)
20. The CSP allow-lists (what breaks when you add a service)

---

*Handbook generated July 2026 from the code at PR #114's merge commit and
the live database catalog. When the code and this document disagree, the
code is right — and this document should be updated in the same PR.*
