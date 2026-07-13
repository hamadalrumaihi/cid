/** GENERATED from docs/handbook/*.md by scripts/generate-handbook.mjs.
 *  DO NOT EDIT — edit the markdown and run `npm run gen:handbook`.
 *  CI verifies this file matches the markdown. */

export interface HandbookPage {
  slug: string
  title: string
  section: string
  body: string
}

export const HANDBOOK_UPDATED = '2026-07-13'

export const HANDBOOK_PAGES: HandbookPage[] = [
  {
    slug: "overview",
    title: "Project Overview",
    section: "Getting started",
    body: `## What the application is

The **CID Portal** is a private, real-time case-management website for the
Criminal Investigation Division of a Grand Theft Auto V roleplay community
("State of San Andreas"). Detectives sign in, open investigation cases, log
evidence and suspects, chat inside a case, link people/gangs/vehicles/places
together, route finished cases up a chain of command for sign-off, and
export court-ready PDF packets. Everything is **live**: when one detective
changes something, every other signed-in screen updates within seconds,
without refreshing.

## Target users

Division members in four effective tiers (§[Ch. 9](09-auth.md) has the
full model): regular members (\`detective\`, \`senior_detective\`), bureau
leads, deputy directors, and command (\`director\`). Members also belong to a
**bureau** — \`LSB\`, \`BCB\`, \`SAB\`, or \`JTF\` — and case visibility is
bureau-scoped.

## Main workflows

1. **Run a case**: create → log evidence/reports/tasks/charges → link intel
   → submit for sign-off → export the court packet ([Ch. 4.1](04-features.md)).
2. **Build intelligence**: registries for persons, gangs, vehicles, places,
   indicators — cross-referenced automatically (deconfliction alerts).
3. **Command oversight**: dashboard KPIs, analytics, heatmap, roster
   approval, announcements, GPS-tracker co-signing.
4. **Personal desk**: My Desk (everything waiting on *you*), watchlist,
   calendar, weekly shift reports, notifications.

## The 30-second architecture

There are only two moving parts (plus a file host):

\`\`\`
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
\`\`\`

- **This repository** is only the front-end: a Next.js app compiled to
  static HTML + JavaScript, served by Vercel. There is **no custom server**
  — no \`/api\` folder, no serverless functions.
- **Supabase** bundles the Postgres database, sign-in ("Auth"), an
  automatic HTTP API over the tables ("PostgREST"), and live change
  notifications ("Realtime"). Every security rule that matters lives
  *inside the database* as SQL policies, functions and triggers.
- **FiveManage** hosts uploaded media; the database stores only URLs.

## Technologies (and why)

| Technology | Why this project uses it |
|---|---|
| **Next.js 16** (App Router) | One dynamic \`[tab]\` route renders all 29 screens; everything pre-renders to static HTML for instant loads; zero-config Vercel deploys. |
| **React 19** | Highly interactive dashboard; state → UI model fits exactly. |
| **TypeScript (strict)** | \`src/lib/database.types.ts\` types every table — a column typo is a build error. |
| **Tailwind CSS v4** | One dark "investigative" design system as theme tokens; no per-component CSS files. |
| **Supabase** | Replaces an entire custom backend; Row Level Security makes a public client key safe. |
| **zustand** | Tiny global stores (toasts, caches) where React context would be overkill — and non-React code (the data layer) must push toasts. |
| **React Flow** | The case investigation graph. |
| **@react-pdf/renderer** | Court-styled PDF packets rendered in the browser. |
| **Tiptap v3** | WYSIWYG editing that *stores plain Markdown*, so exports and other views are untouched. |
| **vitest + GitHub Actions** | Unit tests for the security-critical pure functions; four CI gates on every push. |

## External services

Supabase (data/auth/realtime), FiveManage (media), Discord (OAuth provider
+ optional DM notifications via a Supabase edge function), Vercel
(hosting/previews/rollback), GitHub Actions (CI). Details:
[Ch. 7](07-api.md) and [Quick Reference](appendix-quick-reference.md).

## The one rule

> **The database is the authority. The UI is a convenience.**
> \`canEdit\`/\`canDelete\` in React only hide buttons. Postgres RLS refuses
> rows the signed-in user may not touch, no matter what the JavaScript
> asks. The client is intentionally "dumb" — that's the design, not an
> accident.`,
  },
  {
    slug: "learning-path",
    title: "Learning Path",
    section: "Getting started",
    body: `Each step depends only on the previous ones. Checkboxes for your first
two weeks:

- [ ] **1. The mental model** — [Ch. 1](01-overview.md) + [Ch. 9](09-auth.md).
  *Why first*: "the database is the authority" reframes everything; skip
  it and every view looks over-engineered.
- [ ] **2. Use the app as a user** — the in-app guide (Reference → User
  Guide) or \`docs/USER-GUIDE.md\`. *Why*: you can't debug flows you've
  never run.
- [ ] **3. The three foundation files** — \`lib/supabase.ts\` → \`lib/db.ts\`
  → \`lib/auth.tsx\` (~450 lines total). *Why*: after these, every view's
  first 30 lines read themselves.
- [ ] **4. One registry view end-to-end** — \`vehicles/VehiclesView.tsx\`,
  then diff against \`IndicatorsView\`. *Why*: the whole idiom in one
  self-contained file, and proof of how uniform the pattern is. **You can
  take registry tickets now.**
- [ ] **5. The shell** — \`useNav\` → \`AppShell\` → \`Sidebar\` →
  \`SearchPalette\`. *Why*: how a URL becomes a screen; how ⌘K routes.
- [ ] **6. Realtime + state** — [Ch. 10](10-state.md) + \`lib/realtime.ts\`.
  *Why*: demystifies the "live" magic before you meet it in big views.
- [ ] **7. Cases, one tab at a time** — \`CasesView\` → \`CaseModal\` →
  \`CaseDetail\` (Overview → Tasks → Evidence → Reports → Sign-off last,
  with \`lib/signoff.ts\` and [Ch. 7](07-api.md) beside you). **You can
  take case features now.**
- [ ] **8. The database for real** — [Ch. 8](08-database.md) with the
  Supabase dashboard open; read \`cases\` and \`case_intel_links\` policies.
- [ ] **9. Specialists last** — CaseGraphTab, HeatmapView, InboxView,
  packet/pdf/docx. *Why last*: intricate but leaf-node; nothing else
  depends on them.

Keep [Ch. 12](12-change-impact.md) and the [FAQ](appendix-faq.md) open in
a tab throughout.`,
  },
  {
    slug: "repository-tour",
    title: "Repository Tour",
    section: "The codebase",
    body: `\`\`\`
cid/
├── src/
│   ├── app/                  # Next.js routes (URL → screen mapping)
│   ├── components/           # one folder per screen + shell/ + ui/
│   └── lib/                  # ALL shared logic (the most important folder)
├── supabase/                 # backend: migrations, RLS docs, edge functions
├── docs/                     # this handbook, user guide, hardening status
├── public/                   # static assets (web manifest)
├── .github/                  # CI workflow + Dependabot
├── next.config.ts            # security headers (CSP) + build config
├── vercel.json               # framework + public build env
├── vitest.config.ts          # unit-test config
├── tsconfig.json             # strict TS, "@/…" alias to src/
└── package.json              # dependencies & scripts
\`\`\`

## Folder by folder

### \`src/app/\` — routes and skeleton
Next.js requires this folder: files here map to URLs. \`layout.tsx\` is the
HTML shell (fonts, the pre-hydration theme applier); \`page.tsx\` redirects
\`/\` to the last-visited tab; \`(app)/[tab]/page.tsx\` is the single route
that renders all 29 screens; \`error/global-error/not-found.tsx\` are the
crash/404 screens; \`globals.css\` holds the entire design system.
**Connected to**: everything renders inside it; reads \`lib/nav\` for valid
tabs. Details: [Ch. 5](05-pages.md).

### \`src/components/shell/\` — the chrome
The persistent frame around every screen: \`Sidebar\`, \`Header\` (global
keyboard shortcuts), \`BottomNav\` (mobile), \`Subtabs\`, \`SearchPalette\`
(⌘K), \`NotificationsBell\`, \`ConnBanner\` (offline pill), appearance/profile
modals, and the \`useNav\`/\`useNavBadges\` hooks. **Why it exists**: one
navigation implementation instead of 29. Details: [Ch. 6](06-components.md).

### \`src/components/ui/\` — generic widgets
\`Modal\` (focus trap + dirty guard), \`dialog\` (confirm/prompt), \`Toaster\`,
\`DataTable\` (sort/filter/CSV), \`RichEditor\` (Tiptap). Feature-agnostic —
every feature folder builds on these.

### \`src/components/<feature>/\` — 27 feature folders
One folder per screen (\`cases/\`, \`gangs/\`, \`heatmap/\`, …). Each is
self-contained: fetches its own data, owns its modals. Only the \`[tab]\`
router imports them. \`cases/\` (10 files) and \`command/\` (10 files) are the
big ones. Details: [Ch. 4](04-features.md).

### \`src/lib/\` — the shared foundation ⭐
25 files defining every contract the features obey: the data layer
(\`db.ts\`), auth (\`auth.tsx\`), realtime (\`realtime.ts\`), navigation model
(\`nav.ts\`), domain logic (sign-off, forms, penal code, exports, search,
notifications), and utilities (toast, format, safeUrl, markdown, store).
**Read this folder before touching features.** Details: [Ch. 3](03-architecture.md),
[File Index](appendix-file-index.md).

### \`supabase/\` — the backend's paper trail
\`migrations/\` (59 SQL files replayed by \`supabase db reset\`; note that
later changes were applied directly to the live project — the live schema
is the source of truth), \`functions/\` (the \`discord-notify\` edge
function), and backend READMEs. Details: [Ch. 8](08-database.md).

### \`docs/\` — documentation
This handbook (\`handbook/\`), \`USER-GUIDE.md\` (canonical text of the in-app
guide — the in-app copy \`src/components/guide/guideContent.ts\` is
**generated from it**), \`HARDENING.md\` (security checklist status),
\`DEFERRED.md\` (parked work with triggers), \`RELEASE-READINESS.md\` (v1.0.0
verification). Historical build-era notes (HANDOFF, ROADMAP, REACT-PARITY,
BACKLOG…) are parked in \`archive/\` — see \`archive/README.md\`.

### \`.github/\` — quality gates
\`workflows/ci.yml\` (typecheck → lint → test → build on every push/PR) and
\`dependabot.yml\` (weekly dependency PRs).

### Root config files
\`next.config.ts\` carries the **Content-Security-Policy** — load-bearing
(PDF export and Supabase websockets depend on specific directives).
\`vercel.json\` carries the public build env (previews need it).
\`SETUP.md\` stands up a new Supabase project. \`.env.example\` is the local
env template.`,
  },
  {
    slug: "architecture",
    title: "Architecture Blocks",
    section: "The codebase",
    body: `The codebase divides into nine blocks. **Risk** = how likely a careless
change is to break something important. **Common mistakes** are real traps,
not hypotheticals.

## Block 1 — Configuration & Build
\`next.config.ts\`, \`vercel.json\`, \`tsconfig.json\`, \`vitest.config.ts\`,
\`package.json\`, \`.github/*\`, \`eslint.config.mjs\`
- **Responsibility**: compile, secure (CSP headers), deploy, gate quality.
- **Risk: HIGH.** The CSP is exact: \`wasm-unsafe-eval\` exists for PDF
  export; \`connect-src\` allow-lists Supabase/FiveManage/Discord hosts.
- **Common mistakes**: tightening CSP and silently killing PDF export or
  realtime; forgetting \`vercel.json\` and \`ci.yml\` duplicate the env values.

## Block 2 — Routing & App Shell
\`src/app/*\`, \`src/components/shell/*\`, \`src/lib/nav.ts\`
- **Responsibility**: URL ↔ screen; the constant chrome; nav metadata.
- **Data flow**: URL → \`[tab]/page.tsx\` switch → feature view inside
  \`AppShell\`; \`useNavBadges\` computes the Command-button badges.
- **Risk: MEDIUM-HIGH.** \`nav.ts\` is a three-way contract (PAGE_META keys
  = URL slugs = TAB_LABEL keys) plus the \`[tab]\` switch.
- **Common mistakes**: adding a screen to PAGE_META but not the switch
  (renders a placeholder) or not a category (unreachable from the sidebar).

## Block 3 — Auth & Identity
\`src/lib/auth.tsx\`, \`src/lib/roles.ts\`, \`src/lib/profiles.ts\`,
\`src/components/auth/Gate.tsx\`
- **Responsibility**: sign-in state machine, \`useAuth()\` context,
  capability booleans, roster cache.
- **Risk: HIGH.** ~40 files consume \`useAuth()\`.
- **Common mistakes**: selecting the \`email\` column as a member (it's
  command-granted — use \`PROFILE_COLS\`/\`updateNoSelect\`); using the
  deprecated role-only \`isCommand\` instead of \`meIsCommand\`/auth booleans.

## Block 4 — Data Access
\`src/lib/db.ts\`, \`src/lib/supabase.ts\`, \`src/lib/database.types.ts\`
- **Responsibility**: the ONLY sanctioned path to the database.
- **The contract**: \`list()\` **throws**; mutations **return \`{error}\`**;
  \`updateWhere\` returning zero rows with no error = the predicate matched
  nothing (RLS-blocked or lost race) — treat as failure; \`withRetry\` is
  reads-only; \`deleteWithUndo\` snapshots cascade children before deleting.
- **Risk: HIGH.** Every feature assumes this contract.
- **Common mistakes**: discarding a mutation's \`{error}\` (silent no-op —
  historically a real bug class); auto-retrying a mutation.

## Block 5 — Realtime
\`src/lib/realtime.ts\`
- **Responsibility**: one websocket channel per table (once per session,
  module-level Set), each change bumps a per-table version counter;
  \`useTableVersion(table)\` re-renders subscribers.
- **Risk: MEDIUM.** A lifecycle bug = stale screens or double channels.
- **Common mistakes**: adding a table but forgetting the realtime
  publication (screen only refreshes on remount); subscribing outside the
  registry.

## Block 6 — Feature Views
\`src/components/<feature>/*\` (27 folders)
- **Responsibility**: the screens. Uniform shape: fetch on mount + version
  bump → \`refresh()\`; permission-gated buttons; fresh-mounted modals;
  toasts + Undo for deletes.
- **Risk: varies.** \`cases/CaseDetail.tsx\` (12 tabs, one file per tab in
  \`cases/tabs/\` since v1.1.0) is the
  highest-risk file; registry views are the safest and most uniform.
- **Common mistakes**: breaking the deferred-effect pattern ([Ch. 15](15-conventions.md));
  editing a delete's cascade config without checking the FK schema.

## Block 7 — Domain Libraries
\`src/lib/{signoff,forms,penal,packet,pdf,docx,search,notify,notifText,watchlist,operations,fivemanage}.ts\`
- **Responsibility**: business logic shared across views — sign-off
  vocabulary (read-only interpreter; the chain is SQL!), report schemas,
  penal calculators, the export pipeline, search, notifications.
- **Risk: MEDIUM.** Mostly pure functions.
- **Common mistakes**: renaming a \`FORM_SCHEMAS\` field key (orphans saved
  report data); making \`signoff.ts\` *decide* anything.

## Block 8 — UI Primitives
\`src/components/ui/*\`, \`src/lib/{toast,format,markdown,safeUrl,store,drafts}.ts\`
- **Responsibility**: widgets and helpers everything is assembled from.
- **Risk: MEDIUM.** \`safeUrl\` and \`markdown.tsx\` are XSS surfaces (both
  hard-ruled/tested); \`Modal\`'s focus/dirty/scroll-lock contract is
  everywhere.
- **Common mistakes**: rendering a DB-sourced URL without \`safeUrl\`; any
  \`dangerouslySetInnerHTML\` (one static sanctioned use exists in
  \`app/layout.tsx\`; never add another).

## Block 9 — The Database (lives in Supabase, not this repo)
47 tables, 22 \`private.*\` helpers/trigger functions, 15 public RPCs, RLS
everywhere, realtime publication on most tables.
- **Risk: HIGHEST.** Deployed bundles and open tabs keep querying the old
  shape — migrations must be **additive only**.
- **Common mistakes**: forgetting to hand-update \`database.types.ts\`;
  adding a table without RLS policies (it will be invisible, not open);
  writing sign-off/finalize columns directly (triggers reject it).`,
  },
  {
    slug: "components",
    title: "Components Guide",
    section: "The codebase",
    body: `The reusable building blocks. **Reuse these instead of writing new ones** —
they encode hard-won behavior (focus management, dirty guards, injection
guards).

## \`ui/Modal.tsx\` — THE modal
- **Props**: \`open, onClose, children, wide?, slide?, dismissible=true, dirty?()\`
- **Behavior**: portal to body; focus trap + focus restore; Escape/backdrop
  route through \`requestClose\`, which shows a discard-confirm when
  \`dirty()\` is true; \`beforeunload\` guard; **ref-counted body scroll lock**
  (stacked modals safe); handlers routed through refs so its effect depends
  only on \`[open]\` — this exists because \`AuthProvider\` re-renders hourly
  on token refresh and would otherwise re-mount modal internals.
- **Reuse when**: any overlay. Pair with \`ModalHeader\`. Mount it fresh per
  edit session (state seeds from props — the repo never "resets" modals).

## \`ui/dialog.tsx\` — \`uiConfirm\` / \`uiPrompt\`
Promise-based themed replacements for \`window.confirm/prompt\` +
\`DialogHost\` (mounted in the app layout). Capture-phase keydown so dialog
keys beat an underlying modal's Escape. **Reuse when**: any confirmation
(danger-styled by default) or one-line input.

## \`ui/Toaster.tsx\` + \`lib/toast.ts\`
\`toast(message, type)\` from ANY code (zustand store — no React context
needed); every message passes \`humanizeError\` (Postgres/PostgREST errors →
human copy). \`undoToast\` powers the delete-undo pattern. **Reuse when**:
any feedback. Never \`alert()\`.

## \`ui/DataTable.tsx\`
Declarative columns (\`value()\` feeds sort/filter/CSV; optional \`render()\`,
\`sortValue\`, hidden \`searchText\`); pagination; CSV export guarded against
formula injection (\`csvCell\`, unit-tested). Currently used by AuditView.
**Reuse when**: any tabular list — don't hand-roll another table.

## \`ui/RichEditor.tsx\`
Tiptap v3, **markdown in / markdown out** — storage stays plain text so
\`renderMarkdown\`, exports, and the legacy app all still work. \`value\` is
initial-only; mount fresh per session. **Reuse when**: any long-text field
that renders as markdown elsewhere.

## \`cases/WatchButton.tsx\`
Follow/unfollow for \`case|person|vehicle\`. Stops propagation (works inside
clickable cards). **Reuse when**: a record type becomes followable.

## \`persons/IntelProfile.tsx\`
The person/gang intel slide-over (roll-up + dossier export). Reused by
persons, BOLO, gangs, network. **Reuse when**: any screen needs "show me
everything about this subject".

## Shell components (see [Ch. 2](02-repository-tour.md))
Not usually reused directly, but their **hooks** are: \`useNav()\`
(navigate/activeTab), \`useTableVersion(table)\` (realtime),
\`useAuth()\` (identity/capabilities), \`useProfilesStore\`/\`officerName\`
(name resolution).

## Internal-to-feature components worth knowing
\`CaseDetail\` exports \`RicoTab\` (reused by \`RicoView\` — an internal
cross-import; if you split CaseDetail, keep that export working).
\`GraphNode\`/\`TimelineBand\`/\`HeatSvg\` are specialist SVG/graph pieces —
leaf nodes, safe to study, intricate to edit.`,
  },
  {
    slug: "file-index",
    title: "File & Folder Index",
    section: "The codebase",
    body: `One line per important file. Risk tags: ⚠ = understand before editing.

## Folders

| Folder | Purpose |
|---|---|
| \`.github/\` | CI workflow + Dependabot |
| \`docs/\` | This handbook, user guide, hardening status, historical notes |
| \`docs/handbook/\` | You are here |
| \`public/\` | Static assets (web manifest) |
| \`src/app/\` | Routes, HTML skeleton, error pages, global CSS |
| \`src/components/<feature>/\` | One folder per screen (27) |
| \`src/components/shell/\` | Navigation chrome |
| \`src/components/ui/\` | Generic widgets |
| \`src/lib/\` | ⚠ All shared logic |
| \`supabase/\` | Backend migrations, edge functions, backend docs |

## \`src/lib/\`

| File | One-liner |
|---|---|
| \`auth.tsx\` | ⚠ Sign-in state machine + \`useAuth()\` context + capability booleans |
| \`database.types.ts\` | ⚠ Hand-maintained TS mirror of the live schema |
| \`db.ts\` | ⚠ THE data layer: list/insert/update/remove/rpc/deleteWithUndo/withRetry |
| \`docx.ts\` | Dependency-free OOXML writer (byte-fragile ZIP) |
| \`drafts.ts\` | Unused never-lose-work localStorage util (zero importers) |
| \`fivemanage.ts\` | Media upload (multipart → hosted URL) |
| \`format.ts\` | timeAgo/todayISO/fmtUSD/slug/downloadBlob/copyText |
| \`forms.ts\` | 8 report schemas + warrant helpers + finalize-gap check |
| \`markdown.tsx\` | Safe mini-Markdown → React (no innerHTML, ever) |
| \`nav.ts\` | ⚠ PAGE_META / categories / labels — the nav contract |
| \`notify.ts\` / \`notifText.ts\` | Notification write (RPC, unforgeable) / render vocabulary |
| \`operations.ts\` | Operations zustand cache + status colors |
| \`packet.ts\` / \`pdf.tsx\` | Case-packet gathering / court-styled PDF renderer (dynamic import) |
| \`penal.ts\` | Static penal code (162 charges) + calculators |
| \`profiles.ts\` | Roster cache + \`officerName()\` |
| \`realtime.ts\` | ⚠ One channel per table → version counters (\`useTableVersion\`) |
| \`roles.ts\` | Role/bureau vocabulary + seniority + command predicates |
| \`safeUrl.ts\` | ⚠ XSS scheme allow-list for DB-sourced URLs (tested) |
| \`search.ts\` | \`search_all\` RPC wrapper + penal hits + recents |
| \`signoff.ts\` | Read-only sign-off vocabulary/tints/"whose court" hint |
| \`store.ts\` | The shared localStorage blob (legacy-compatible keys) |
| \`supabase.ts\` | ⚠ Lazy client singleton + \`isConfigured\` |
| \`toast.ts\` | Toast store + \`humanizeError\` |
| \`watchlist.ts\` | Follow-store + seen stamps |

## \`src/app/\` & \`src/components/shell|ui/\`

| File | One-liner |
|---|---|
| \`app/layout.tsx\` | Root HTML, fonts, pre-hydration theme applier (the one sanctioned innerHTML) |
| \`app/page.tsx\` | ⚠ \`/\` redirect shim + OAuth-callback wait |
| \`app/(app)/layout.tsx\` | AuthProvider → Gate/AppShell boundary |
| \`app/(app)/[tab]/page.tsx\` | ⚠ The 29-way switch |
| \`app/globals.css\` | ⚠ Theme tokens, accent remap, collapse contract, editor styles |
| \`app/error/global-error/not-found.tsx\` | Crash and 404 screens |
| \`shell/AppShell.tsx\` | Chrome composition + tab persistence |
| \`shell/Header.tsx\` | Title bar, \`/\` & ⌘K shortcuts, LOA, sign-out |
| \`shell/Sidebar.tsx\` | ⚠ Categories, badges, body-class collapse |
| \`shell/BottomNav.tsx\` / \`Subtabs.tsx\` | Mobile bar / in-category tab strip |
| \`shell/SearchPalette.tsx\` | ⚠ ⌘K search + quick actions |
| \`shell/NotificationsBell.tsx\` | Live bell + mark-read |
| \`shell/useNav.ts\` / \`useNavBadges.ts\` | Routing helpers / ⚠ badge logic mirroring server rules |
| \`shell/ConnBanner\` / \`AppearanceModal\` / \`MyProfileModal\` / \`icons\` | Offline pill / accent+density / self-profile / SVG icons |
| \`ui/Modal.tsx\` | ⚠ Focus trap, dirty guard, scroll-lock, ref-routed handlers |
| \`ui/dialog.tsx\` | uiConfirm/uiPrompt + host |
| \`ui/DataTable.tsx\` | Sort/filter/CSV table (+ injection-guarded \`csvCell\`) |
| \`ui/RichEditor.tsx\` | Tiptap markdown editor |
| \`ui/Toaster.tsx\` | Toast renderer |

## Feature views (main file per folder)

\`analytics/AnalyticsView\` (charts) · \`announce/AnnounceView\`+Modal+utils ·
\`audit/AuditView\` (owner-only) · \`auth/Gate\` ·
\`ballistics/BallisticsView\` · \`bolo/BoloView\` (warrant chips) ·
\`calendar/CalendarView\` · \`casefiles/CaseFilesView\` (uploads) ·
\`cases/\`: ⚠\`CasesView\`, ⚠\`CaseDetail\` (12 tabs, one file each in \`tabs/\`), ⚠\`CaseModal\`,
\`CaseBoard\`, \`CaseFilterBar\`, ⚠\`CaseGraphTab\`, \`TimelineBand\`,
\`caseUtils\`, \`StaleBadge\`, \`WatchButton\` ·
\`command/\`: ⚠\`CommandView\` + 8 widgets + \`commandUtils\` ·
\`feedback/FeedbackView\` · \`gangs/\`⚠\`GangsView\` · \`guide/GuideView\`
(+generated \`guideContent.ts\`) · \`heatmap/\`⚠\`HeatmapView\` ·
\`inbox/\`⚠\`InboxView\` · \`indicators/IndicatorsView\` (matchKey) ·
\`media/MediaView\` · \`modus/ModusView\` (crossref) ·
\`narcotics/NarcoticsView\` · \`network/NetworkView\` ·
\`operations/OperationsView\` · \`penal/PenalView\` ·
\`personnel/\`: PersonnelView, AdminPanel, ⚠AssignModal, Commendations ·
\`persons/\`: PersonsView, PersonModal, ⚠IntelProfile, dossier ·
\`places/PlacesView\` · \`records/RecordsView\` (zero-rows check) ·
\`rico/RicoView\` (imports CaseDetail's RicoTab) · \`shifts/ShiftsView\` ·
\`sops/SopsView\` (version snapshots) · \`vehicles/VehiclesView\` (scanner) ·
\`ViewPlaceholder\`.

## Root config

\`next.config.ts\` ⚠ (CSP) · \`vercel.json\` (public build env) ·
\`vitest.config.ts\` · \`tsconfig.json\` (\`@/\` alias) · \`eslint.config.mjs\` ·
\`.env.example\` · \`SETUP.md\` · \`package.json\`.`,
  },
  {
    slug: "features",
    title: "Feature Guide",
    section: "Features & pages",
    body: `Every major feature, with its complete data flow. File-level detail lives
in the [File Index](appendix-file-index.md); table/RPC details in
[Ch. 8](08-database.md).

## 4.1 The case lifecycle (flagship)

**Purpose**: the central investigation record. **Permissions**: bureau-
scoped (\`can_access_case\`); deletes command-only.

1. **Create** — \`CasesView\` "+ New Case" (or ⌘K "new case", or the ticket
   wizard) → \`CaseModal\`: template chips prefill fields + a task
   checklist; \`insert('cases')\` with \`case_number = BUREAU-digits\`;
   checklist rows → \`insert('case_tasks')\`.
2. **Work it** — \`CaseDetail\`'s 12 tabs (Overview, Graph, Evidence, Notes,
   Charges, RICO, Intel, Reports, Tasks, Sign-off, Chat, Timeline) each
   fetch and write their own case-scoped tables. Custody transfers append
   to the immutable \`custody_chain\`.
3. **Move it** — drag on the board → \`update('cases', {status})\`; triggers
   stamp \`closed_at\`/\`updated_at\`.
4. **Stale escalation (automatic)** — once per session, \`CasesView\` finds
   open/active cases quiet ≥14 days, claims them with a compare-and-swap
   (\`updateWhere … last_stale_notified_at is null\`) and notifies
   lead/bureau-leads/deputy. The CAS prevents two open tabs double-firing.
5. **Sign-off** — \`rpc('signoff_submit')\` → SQL picks the stage + a
   non-LOA assignee → reviewer \`rpc('signoff_decide')\`, owner
   \`rpc('signoff_owner_action')\`. History rows + notifications are written
   inside the RPCs. Direct column writes are trigger-blocked.
6. **Export** — the packet button gathers everything
   (\`lib/packet.gatherCasePacket\`, partial-tolerant) and renders PDF
   (dynamic-imported \`lib/pdf\`), DOCX (\`lib/docx\`), or Markdown.
7. **Delete** — \`deleteWithUndo\` with cascade config; Undo restores
   parents + children with original ids.

**Data flow**: user action → \`db.ts\` helper → PostgREST → RLS check →
row change → realtime event → version bump → every subscribed view
refetches → UI updates (including other users' browsers).

## 4.2 Intelligence registries

Persons, gangs (ranks/members/turf), vehicles, places, narcotics,
ballistics, media vault, records, BOLO board — all one uniform pattern
(fetch + version counter, \`?q=\` seeded filter, card grid, modal CRUD,
canEdit/canDelete gates, \`deleteWithUndo\`). Shared RLS: any active member
reads/writes, command deletes. The \`IntelProfile\` slide-over
(persons/gangs) rolls up everything linked to a subject and exports
dossiers.

## 4.3 Deconfliction (three systems)

- **Indicators registry** (server data): hard identifiers per case; a
  normalized \`matchKey\` (separators stripped for phone/account/serial)
  matching across ≥2 cases raises a ⚡ alert. Matches into cases you can't
  see render as 🔒 restricted stubs — value visible, case hidden.
- **Vehicles scanner** (client heuristics): phones/plates/persons across
  ≥2 visible cases from report text + intel links. A failed scan shows
  Retry — never a false "no matches".
- **M.O. crossref** (RPC): existence-only matches into other bureaus'
  cases with a request-access flow — a *deliberate, controlled* leak.

## 4.4 Global search & commands (⌘K)

\`Header\` shortcut → \`SearchPalette\` → debounced \`runSearch\` → \`search_all\`
RPC (pg_trgm fuzzy, RLS-scoped, SECURITY INVOKER) + static penal-code
hits + quick actions (New case, LOA, sign out, go-to-tab). A sequence
guard drops out-of-order responses. Enter deep-links (\`?case=\`, \`?q=\`).

## 4.5 Command tools

Dashboard (KPIs + 8 widgets incl. the ticket wizard that *creates cases*
and the dual-co-sign GPS trackers — self-co-sign blocked in UI *and* by
trigger), division analytics (SVG charts, Monday-week buckets),
announcements (audience-targeted: everyone/\`@everyone\` for deputy+ only,
command, own/specific department, or just the mentioned members — the
\`publish_announcement()\` RPC resolves recipients server-side with one
notification each, a recipient-count preview and confirm in the composer,
and edits never re-notify unless explicitly requested), heatmap
(weighted layers, pan/zoom SVG map), roster (membership requests: new
sign-ins request ONE permanent department — LSB/BCB/SAB, never JTF — plus
a rank-and-file role from the inactive-account screen; the Approval Queue
reviews them via \`review_membership_request()\` — approve /
approve-with-changes / request-correction / reject — activating the
profile only on approval; the legacy one-click \`assign_member\` approve
remains for requestless profiles). Joint cases:
\`convert_case_to_joint()\` tags a case JTF while preserving its
originating bureau and grants selected members temporary case-scoped
access (joint roles, optional expiry, removable, endable) — access model
in Ch. 8.

## 4.6 Personal tools

My Desk (ten derived panels over eight live tables), watchlist (follow +
"updated" chips via localStorage seen-stamps), calendar (follow-ups, task
due dates, report weeks), shift reports (one per week enforced by unique
key, auto-rollup), notifications bell.

## 4.7 Reference & exports

Penal code (static data + calculators), SOPs & library (version snapshot
BEFORE every overwrite; command-write-only folders), the visual user
guide, court packet/dossier exports, audit-log CSV export
(formula-injection-guarded).`,
  },
  {
    slug: "pages",
    title: "Page Guide",
    section: "Features & pages",
    body: `## The routing model

Next.js maps folders under \`src/app/\` to URLs. This app has three
user-facing routes:

| URL | File | Renders |
|---|---|---|
| \`/\` | \`app/page.tsx\` | Redirect shim: legacy \`#deep-links\`, else last-visited tab, else \`/command\`. Also the OAuth landing spot — it **waits** for the auth event before redirecting. |
| \`/<tab>\` | \`app/(app)/[tab]/page.tsx\` | One of 29 screens. Invalid slugs → \`/command\`; legacy \`reports\` → \`/cases\`. |
| anything else | \`app/not-found.tsx\` | Styled 404. |

\`(app)/layout.tsx\` wraps every tab in \`AuthProvider\` → \`Gate\` (sign-in
screens when not authenticated) → \`AppShell\` (chrome). All 29 routes are
**statically pre-rendered** — safe because pages embed no data; everything
fetches after mount behind RLS.

**Deep-link parameters**: \`?case=<id>\` (open case detail), \`?q=\` (seed a
registry filter), \`?new=1\` (open New Case), \`?op=\` (operation),
\`?focus=g:<id>|p:<id>\` (network), \`?tab=\` (case detail tab).

**Shared states**: every screen renders "Loading…" while fetching,
"Could not load: reason" on failure (reads throw), an ALL-CAPS themed
empty state, and a sign-in notice when unauthenticated.

## The 29 screens

| Slug | Screen (component) | Data highlights | Extra permissions |
|---|---|---|---|
| \`command\` | Dashboard (\`CommandView\` + 8 widgets) | cases, evidence, tickets, trackers, raid comp | filter bar/scorecards command-only |
| \`analytics\` | Division Analytics | cases, evidence, persons (charts) | — |
| \`announce\` | Announcements | announcements | posting = command |
| \`heatmap\` | Crime Heatmap | cases, turf, places, raids | — |
| \`personnel\` | Roster & Commendations | profiles (+ admin RPCs), commendations | admin panel = command |
| \`cases\` | Case board + detail | the whole case constellation | bureau-scoped |
| \`operations\` | Task Forces | operations, cases | — |
| \`case-files\` | Attachments | case_files + FiveManage | delete = command |
| \`rico\` | RICO tracker | rico_cases, predicate_acts | — |
| \`persons\` | Persons → IntelProfile | persons, gang_members, vehicles | — |
| \`bolo\` | BOLO Board | persons(bolo), warrant reports | — |
| \`gangs\` | Gangs | gangs, ranks, members, turf | — |
| \`places\` | Places | places, process steps | — |
| \`vehicles\` | Vehicle Registry | vehicles + cross-ref scan | — |
| \`indicators\` | Indicators | indicators + deconfliction | — |
| \`network\` | Network graph | gangs, persons, members | — |
| \`narcotics\` | Narcotics | narcotics + precursors + hotspots | — |
| \`ballistics\` | Ballistics | benches + footprints | — |
| \`modus\` | M.O. Detector | mo_profiles + \`mo_crossref\` RPC | — |
| \`media\` | Media Vault | media + FiveManage | — |
| \`records\` | Records | cid_records | edit = creator/command |
| \`penal\` | Penal Code | static (no DB) | — |
| \`sops\` | SOPs & Library | documents + versions | writes = command |
| \`guide\` | User Guide | static visual guide | — |
| \`inbox\` | My Desk | 8 tables, 10 panels | self-scoped |
| \`calendar\` | Calendar | cases, tasks, shift weeks | — |
| \`shifts\` | Shift Reports | shift_reports | edit own |
| \`audit\` | Audit Log | audit_log (DataTable + CSV) | **owner-only** |
| \`feedback\` | Feedback (sidebar leaf) | feedback | triage = 2 owners |`,
  },
  {
    slug: "api",
    title: "API Guide",
    section: "Data & API",
    body: `This app has **no hand-written HTTP endpoints**. Its "API" is Supabase's
auto-generated layer plus its database functions. All requests carry the
user's JWT automatically (the Supabase client attaches it); **every**
response is filtered by RLS.

## 1. Table REST (\`/rest/v1/<table>\`)

Generated by PostgREST for all tables; the app only calls it through
\`src/lib/db.ts\` ([Ch. 3, Block 4](03-architecture.md)). Validation =
database constraints (NOT NULL, checks, uniques, FKs) surfaced through
\`humanizeError\`. There is no other request validation layer — by design.

## 2. RPCs (\`/rest/v1/rpc/<fn>\`) — the real "endpoints"

All require a signed-in session (anonymous EXECUTE was revoked). All are
SECURITY DEFINER (run privileged, then check the caller inside) except
\`search_all\` (SECURITY INVOKER so results honor row access).

| RPC | Request | Response | Called from | Why it exists |
|---|---|---|---|---|
| \`search_all(q)\` | search string | ranked hits across 9 tables | SearchPalette | one round-trip fuzzy search, RLS-scoped |
| \`signoff_submit(p_case)\` | case id | updated case | CaseDetail | atomically route + stamp + history + notify; columns are trigger-locked |
| \`signoff_decide(p_case, p_decision, p_note)\` | case id, approve/deny/changes, note | updated case | CaseDetail | reviewer decision, validated against the current assignee |
| \`signoff_owner_action(p_case, p_action)\` | case id, complete/escalate/… | updated case | CaseDetail | owner-side chain actions |
| \`report_finalize(p_report, p_badge)\` | report id, badge | report row | CaseDetail Reports | the ONLY way to set \`finalized\`; stamps signer |
| \`assign_member(target, role, division, active)\` | profile id + assignment | void | AssignModal/AdminPanel | command-checked role/bureau/activation (guard trigger blocks direct writes) |
| \`admin_member_emails()\` | — | roster emails | PersonnelView | command-only bypass of the email column grant |
| \`admin_remove_member\` / \`admin_restore_member(p_target)\` | profile id | void | AdminPanel | soft remove/restore (\`removed_at\`) |
| \`create_notification(user, type, payload)\` | recipient + payload | void | \`lib/notify.ts\` | insert for ANOTHER user with the actor stamped server-side (no forgery) |
| \`mo_crossref(terms[])\` | term list | existence-only case matches | ModusView | controlled cross-bureau M.O. matching |
| \`report_reopen(p_report)\` | report id | report row | CaseDetail Reports | bureau-scoped seal break; prior signature kept in \`fields._reopen_log\` |
| \`warrant_set_status(p_report, p_status)\` | report id + status | report row | CaseDetail Reports | validated warrant lifecycle; only path on sealed warrants |
| \`membership_request_submit\` / \`_withdraw(p_request)\` | request id | request row | Gate (inactive screen) | applicant-side transitions; submit notifies command |
| \`review_membership_request(p_request, p_decision, …)\` | decision + final dept/role + notes | request row | ApprovalQueue | command decision; activates profile ONLY on approval; role_events + history + audit atomically |
| \`admin_membership_requests()\` | — | all request rows | ApprovalQueue | command-only bypass of the internal-note column grant |
| \`deny_member_login(p_target, p_reason)\` / \`restore_member_login(p_target)\` | profile id + reason | profile row | AssignModal | app-level login block (Command/Owner, bureau-lead scoped); denied users hit an "Access denied" gate and can't file a request; \`login_denied*\` frozen by a non-definer trigger |
| \`convert_case_to_joint\` / \`joint_case_add_members(p_case, p_members)\` | case + member list | summary | CaseDetail/Overview | joint rows are RPC-only; bureau never flips to JTF |
| \`joint_case_remove_member(p_case, p_officer, p_reason)\` | case + member | void | Overview | immediate revoke, history preserved |
| \`joint_case_end(p_case, p_note)\` | case id | void | CaseDetail | closes all temporary joint access |
| \`publish_announcement(title, body, audience, …)\` | announcement + audience | \`{announce_id, recipients}\` | AnnouncementModal | server-side fan-out, one notification per recipient |
| \`announcement_recipient_count(p_audience, p_mentions)\` | audience | count | AnnouncementModal | composer preview |
| \`announcement_notify_update(p_announce)\` | announcement id | count | AnnouncementModal | explicit re-notify on edit (never automatic) |
| \`bootstrap_command\` / \`bootstrap_director(email)\` | email | text | nobody (setup-era) | first-user bootstrap; candidates for removal |

### DOJ legal-review RPCs (v1.13.0)

Justice identity and legal review are a **separate domain** (see
[\`docs/DOJ-INTEGRATION.md\`](../DOJ-INTEGRATION.md)). Every legal table is
SELECT-only for clients; these definer RPCs are the only write path.

| RPC | Purpose |
|---|---|
| \`justice_membership_request_submit\` / \`_withdraw(p_request)\` | applicant-side justice onboarding transitions |
| \`review_justice_membership_request(p_request, p_decision, p_final_agency, p_final_role, …)\` | DA/AG/Owner decision; activates the justice membership atomically (approval matrix enforced) |
| \`admin_justice_membership_requests()\` | reviewer-only full read (incl. the revoked internal note) |
| \`set_justice_membership_active(p_target, p_active)\` | deactivate/reactivate a justice membership |
| \`assign_ada_to_bureau\` / \`set_primary_ada\` / \`set_acting_ada\` / \`end_ada_bureau_assignment\` | DA/AG/Owner manage bureau ADA coverage (assignments, not roles) |
| \`doj_bureau_coverage()\` | coverage board (primary/acting/supporting per bureau) |
| \`create_legal_request\` / \`update_legal_draft\` | draft a warrant or subpoena on an accessible case |
| \`add_legal_exhibit\` / \`remove_legal_exhibit\` | build the deliberate packet (source validated against caller's own access) |
| \`submit_legal_request_to_cid\` / \`review_legal_request_as_cid\` | CID supervisor stage; approval freezes a version + auto-routes to the bureau ADA |
| \`submit_legal_request_to_doj\` / \`reassign_legal_ada\` | DA/AG/Owner manual routing / cross-bureau override (reason required) |
| \`review_legal_request_as_ada\` / \`_da\` / \`_ag\` | prosecutorial review (return / submit-onward / DA-or-AG approve on their route) |
| \`assign_judge\` / \`decide_legal_request_as_judge\` | judicial assignment (conflict-of-role checked) and decision (signs the exact version) |
| \`issue_legal_request\` / \`record_warrant_execution\` / \`record_warrant_return\` | CID-side warrant fulfilment |
| \`record_subpoena_service\` / \`record_subpoena_compliance\` | CID-side subpoena fulfilment (materials link back to the case) |
| \`set_legal_approval_route\` / \`resolve_case_originating_bureau\` | DA/AG route change; CID supervisor sets a legacy JTF case's responsible bureau |
| \`close_legal_request\` / \`withdraw_legal_request\` | close / expire / revoke; creator withdraw (records preserved) |
| \`legal_search(q)\` | RLS-limited header search (SECURITY INVOKER — sealed rows undiscoverable) |
| \`legal_internal_notes(p_request)\` | prosecution/judicial-side internal notes (column-revoked otherwise) |
| \`justice_directory()\` / \`legal_request_people(p_request)\` | name resolution for justice-only users (no roster access) |
| \`mdt_wanted_current()\` | classification-safe wanted projection; effective status computed at read time |

**Error handling**: RPCs come back through \`rpc()\` as \`{error}\` — callers
toast it. RPC-internal permission failures raise exceptions that surface
the same way.

## 3. Auth endpoints
Supabase Auth handles OAuth (Discord/Google) and magic links; the app only
calls \`signInWithOAuth\`/\`signInWithOtp\`/\`signOut\` via the client library.

## 4. Realtime
A websocket (\`wss://…supabase.co\`) with one channel per table
(\`postgres_changes\`). No payloads are consumed — only "something changed"
(see [Ch. 10](10-state.md)).

## 5. FiveManage (external)
\`POST \${BASE_URL}/api/{image|video|audio}\` multipart with the public
API key; response's URL is stored in \`case_files\`/\`media\`. Errors throw
and are toasted per file.`,
  },
  {
    slug: "database",
    title: "Database Guide",
    section: "Data & API",
    body: `The database is a Supabase-hosted Postgres project. \`supabase/migrations/\`
carries the early lineage; **later changes were applied directly to the
live project, so the live schema is the source of truth**, mirrored by
hand in \`src/lib/database.types.ts\`. Everything below was read from the
live catalog (July 2026).

## 8.1 Enumerated types

| Enum | Values |
|---|---|
| \`app_role\` | detective, senior_detective, supervisor, bureau_lead, deputy_director, director, command *(supervisor/command are legacy labels; the app uses the 5-role ladder)* |
| \`bureau\` | LSB, BCB, SAB, JTF |
| \`case_status\` | open, active, cold, closed |
| \`assign_role\` / \`report_kind\` / \`evidence_tamper\` / \`media_type\` / \`doc_kind\` / \`location_type\` / \`bench_type\` / \`tracker_status\` / \`threat_level\` / \`density\` | see [Quick Reference](appendix-quick-reference.md) |

## 8.2 The tables, grouped by RLS pattern

### Case-scoped (every action needs \`private.can_access_case(case_id)\`)
The hub \`cases\` (28 cols — number, title, bureau, status, lead, summary,
follow-up, stale stamps, operation link, **trigger-locked sign-off
columns**, joint-case flags \`is_joint_case\`/\`originating_bureau\`/
\`joint_case_*\` — conversion never flips \`bureau\`, because \`bureau='JTF'\`
means division-wide visibility) plus its satellites: \`case_assignments\`
(now the joint-membership ledger too: \`assignment_source\`, \`joint_role\`,
\`temporary\`, \`expires_at\`, \`removed_*\` — joint rows are **RPC-only**, and
an active unexpired joint row grants access to exactly that case via
\`private.has_joint_access\`), \`evidence\` (+
append-only \`custody_chain\`), \`reports\` (finalize RPC-only),
\`case_tasks\` (sub-tasks via \`parent_id\`; delete = command OR own row),
\`case_messages\` (author trigger-stamped; edit/delete author-or-command),
\`case_intel_links\` (polymorphic case→person/gang/place — feeds the Intel
tab, graph, packets), \`case_files\` (**keyed by case_number text**, legacy),
\`case_signoff_history\` (append-only), \`rico_cases\`+\`predicate_acts\`,
\`mo_profiles\`, \`raid_compensations\`, \`trackers\` (bureau-scoped when not
case-linked; command writes), \`case_access_grants\`/\`_requests\`
(cross-bureau sharing), \`case_templates\` (read all, write command).

**Why they exist**: one table per case artifact keeps RLS simple — every
policy delegates to the same helper.

### Shared intel (active member read/insert/update; command delete)
\`persons\`, \`gangs\`+\`gang_ranks\`+\`gang_members\`+\`gang_turf\`, \`vehicles\`,
\`places\`+\`place_process_steps\`, \`narcotics\`+\`narcotic_precursors\`+
\`narcotic_hotspots\`, \`ballistics_benches\`+\`ballistic_footprints\`,
\`indicators\`, \`media\`, \`cid_records\` (update: creator or command),
\`operations\`, \`tickets\`, \`commendations\`, \`documents\`+\`documents_versions\`
(protected folders command-write-only).

**Read by** their screens + every picker/graph/packet. **Written by** any
active member's browser. **Deleted by** command via \`deleteWithUndo\`.

### Own-row (keyed to \`auth.uid()\`)
\`notifications\` (insert ONLY via RPC — actor can't be forged), \`watchlist\`,
\`shift_reports\` (command may read/update all), \`feedback\` (+2 triage
owners), \`profiles\` (self-update allowed; \`guard_profile\` trigger blocks
self-changing role/active/bureau; \`email\` column readable by command only).

### System
\`audit_log\` (written ONLY by the \`private.audit()\` trigger and the
membership/joint/announcement RPCs; readable by one owner UUID),
\`announcements\` (write = \`can_announce()\` + \`can_post_audience(audience)\`;
SELECT is audience-scoped: 'all', own division, 'command' for command,
'members' for mentioned users, author, command/owner oversight),
\`membership_requests\` (one per applicant; INACTIVE applicant inserts/edits
own form fields, decision columns trigger-frozen, \`internal_decision_note\`
column-revoked — command reads via \`admin_membership_requests()\`) +
append-only \`membership_request_history\` (definer-RPC writes only),
\`app_secrets\` (RLS on, **zero policies** = invisible to all client roles —
deliberate).

## 8.3 Helper functions (\`private\` schema)

\`is_active / is_command / role / can_delete / can_announce /
can_post_audience / can_access_bureau / can_access_case /
can_access_case_number / can_access_case_row / can_create_case /
can_grant_case / has_joint_access / can_manage_joint\` — the policy
building blocks. \`signoff_pick / signoff_route / signoff_status_of\` — the
routing brain (LOA-aware assignee choice). All SECURITY DEFINER with
pinned empty \`search_path\`.

## 8.4 Public RPCs

See [Ch. 7](07-api.md) for the full table. Rule of thumb: anything that
must be atomic + permission-checked + multi-row is an RPC, never client
logic.

## 8.5 Triggers

| Family | Tables | Effect |
|---|---|---|
| \`private.audit()\` AFTER I/U/D | 20 tables | The app's audit logging — no client write path |
| \`touch\` family BEFORE UPDATE | ~25 tables | Honest \`updated_at\` (drives staleness + analytics) |
| \`stamp_author_identity\` BEFORE INSERT | case_messages, announcements | Real author enforced server-side |
| Guard triggers | profiles, cases, reports, trackers | Block self-promotion, direct sign-off/finalize writes, self-co-sign |
| \`set_case_closed_at\` | cases | Stamps closure time |
| \`handle_new_user\` | auth.users | Creates the inactive profile on first sign-in |

## 8.6 Realtime publication

Most tables are in the \`supabase_realtime\` publication. NOT published:
\`app_secrets\`, \`feedback\`, \`watchlist\`, \`operations\` — their screens
refresh on remount only. **If a new screen feels stale, check the
publication first.**

## 8.7 What breaks if the schema changes

- **Rename/remove a column** → \`database.types.ts\` drift (silent runtime
  \`undefined\` until hand-updated), \`select\` projection strings fail at
  runtime (grep for the name!), RLS policies referencing it, and every
  open browser tab on the old bundle. **Rule: additive only.**
- **Add a table** → hand-add types, add RLS (no policies = invisible),
  add to the realtime publication, add FK indexes.
- **Change an enum** → Postgres enums only append; update the TS union +
  any UI constant (\`CASE_STATUSES\`, indicator \`KINDS\`) together.`,
  },
  {
    slug: "state",
    title: "State Management",
    section: "Data & API",
    body: `The app deliberately has **no general data cache**. Layers, narrowest to
widest:

| Layer | What lives there | Where |
|---|---|---|
| Component state (\`useState\`) | Screen-local rows, filters, modal state, form fields (modals mount fresh per open) | every view |
| Derived state (\`useMemo\`) | Filtering, grouping, chart buckets, graph building | big views |
| React Context | Exactly one: \`AuthProvider\` (session/profile/capabilities) | \`lib/auth.tsx\` |
| zustand stores | Toasts, dialogs, realtime versions, profiles cache, operations cache, watchlist — singletons that non-React code must reach | \`lib/*\`, \`ui/dialog\` |
| localStorage (\`Store\`) | Device preferences + legacy-app continuity, ONE JSON blob (\`cid-portal-v3\`) | \`lib/store.ts\` |
| The database | ALL shared data — every screen refetches on mount and on realtime bumps | Supabase |

## The refresh idiom (memorize — it's in ~30 files)

\`\`\`tsx
const version = useTableVersion('cases')            // realtime counter
const refresh = useCallback(async () => { … }, [state])
useEffect(() => {
  const t = setTimeout(() => { void refresh() }, 0) // deferred: lint-clean,
  return () => clearTimeout(t)                      // deterministic prerender
}, [refresh, version])
\`\`\`

**How data moves**: user action → \`db.ts\` write → Postgres → realtime
event → channel handler bumps \`versions[table]\` → every subscribed view's
effect refires → refetch → UI updates. Other users' browsers get the same
websocket event, so everyone converges. Simple — no cache invalidation —
at the cost of whole-table refetches ([Ch. 17](17-performance.md)).

## Async races

Sequence guards (\`seq\` counters in SearchPalette/IntelProfile, \`cancelled\`
flags in the vehicles scanner) ensure only the newest request's result
lands. If you add a fetch that can overlap itself, copy that pattern.

## Realtime lifecycle

\`subscribeTable\` opens ONE channel per table per session (module-level
Set); sign-out removes all channels (\`auth.tsx\`) and resets the registry.
\`useTableVersion\` is the only consumer API — never open channels directly.`,
  },
  {
    slug: "dependency-map",
    title: "Dependency Map",
    section: "Data & API",
    body: `## Runtime layers

\`\`\`
        ┌────────────────────────── Browser ──────────────────────────┐
        │  app/(app)/[tab]/page.tsx ── 29 feature views                │
        │        │                        │                            │
        │   shell/* (chrome)          ui/* (Modal, DataTable, …)       │
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
        │  Auth ─ profile trigger │             └─────────────┘
        │  PostgREST ─ RLS ─ 47 t │
        │  RPCs ─ private.* fns   │──► edge fn ──► Discord DM
        │  Realtime publication   │
        └─────────────────────────┘
\`\`\`

## One interaction, end to end

\`\`\`
User clicks "Save" in a modal
  ↓ component save() builds a payload
  ↓ lib/db.insert('vehicles', payload)          ← the only DB path
  ↓ lib/supabase client attaches the JWT
  ↓ PostgREST INSERT … RLS: private.is_active()
  ↓ triggers: touch / audit
  ↓ {data} back → toast('registered') → modal closes
  ↓ realtime: postgres_changes event on rt_vehicles (all browsers)
  ↓ lib/realtime bumps versions.vehicles
  ↓ every view with useTableVersion('vehicles') refetches
  ↓ UI shows the new row — including for OTHER signed-in users
\`\`\`

## The load-bearing import edges

- \`lib/db\` ← ~44 components + 6 libs (the fattest edge)
- \`lib/auth\` ← ~40 files · \`lib/profiles\` ← ~24 · \`lib/format\` ← ~25
- \`persons/IntelProfile\` ← persons, bolo, gangs, network
- \`cases/CaseDetail\` ← CasesView AND RicoView (internal \`RicoTab\` import)
- \`lib/forms\` ← CaseDetail, BoloView, CaseGraphTab, dossier, packet
- \`guideContent.ts\` ← **generated from** \`docs/USER-GUIDE.md\``,
  },
  {
    slug: "auth",
    title: "Authentication & Permissions",
    section: "Security & auth",
    body: `## Login flow (who are you?)

\`\`\`
   visitor                 Supabase Auth              this app
      │  click Discord/Google  │                          │
      ├───────────────────────►│  OAuth redirect          │
      │◄───────────────────────┤                          │
      │  land on "/" with tokens                          │
      ├──────────────────────────────────────────────────►│ page.tsx WAITS for
      │                        │◄─────────────────────────┤ the auth event, then
      │                        │  session (JWT) stored    │ redirects to a tab
      │                        │                          │
      │            auth.tsx evaluate(): fetch profiles row│
      │  state = 'in' (active) │ 'pending' (not approved) │ 'error' (retry)
\`\`\`

- Three ways in: Discord OAuth, Google OAuth, emailed magic link. No
  passwords stored.
- The **session** is a signed JWT the client library attaches to every
  request and auto-refreshes hourly.
- First sign-in: a database trigger creates a \`profiles\` row with
  \`active=false\`. The UI shows "not yet approved"; **every** RLS check
  fails until Command activates the profile (Roster screen →
  \`assign_member\` RPC).
- \`AuthProvider\` (\`lib/auth.tsx\`) exposes the state machine
  (\`loading|setup|out|pending|error|in\`) via \`useAuth()\`; a sequence
  guard keeps bursty auth events from applying stale results.

## Roles

\`detective\` → \`senior_detective\` → \`bureau_lead\` → \`deputy_director\` →
\`director\`. **Command staff** = bureau_lead (within their bureau) +
deputy_director + director (global). Plus a bureau:
\`LSB | BCB | SAB | JTF\`. One canonical definition: \`src/lib/roles.ts\`.

## Permissions (what may you do?) — three layers

\`\`\`
Layer 1  UI hints        canEdit / canDelete / isCommand   → hides buttons only
Layer 2  RLS policies    private.* helpers on all 47 tables → the real wall
Layer 3  Guard triggers  column-level locks                 → even allowed writers
                                                              can't touch protected
                                                              columns directly
\`\`\`

- **Layer 1** comes from \`useAuth()\`: \`canEdit\` = active member;
  \`canDelete\`/\`isCommand\` = active + command role. Cosmetic only.
- **Layer 2**: every table's policies delegate to \`private.is_active()\`,
  \`can_access_case()\`, \`can_delete()\`, etc. ([Ch. 8](08-database.md)).
  Patterns: shared-intel / case-scoped / own-row / system.
- **Layer 3**: \`guard_profile\` (no self-promotion),
  \`block_direct_signoff\`, \`block_direct_report_finalize\`,
  \`block_tracker_self_cosign\`.

**Why**: the anon key ships in the JavaScript bundle — anyone can read it.
That is safe only because the key grants nothing; every row crosses RLS.
Client-side "security" would be theater.

## Route protection

There is none server-side — every route serves the same static shell.
Protection = \`Gate\` blocks the UI when signed out + RLS returns zero rows
to anyone who bypasses the UI. This is why pre-rendering all routes is
safe.

## The traps

- A write blocked by RLS does **not** throw — it returns \`{error}\` or
  zero rows. Always surface it ([Ch. 13](13-debugging.md)).
- Members cannot select \`profiles.email\` (command column grant) — use
  \`PROFILE_COLS\` / \`updateNoSelect\`.
- UI mirrors of server rules exist in \`useNavBadges.canReviewCase\` and
  \`Subtabs\` (audit owner) — keep them matching the SQL or users see
  phantom badges/tabs.`,
  },
  {
    slug: "security",
    title: "Security Notes",
    section: "Security & auth",
    body: `## The model, one line

**Anon key public → RLS is the wall → SECURITY DEFINER RPCs are the
doors → guard triggers are the locks on specific columns.**

## Verified strong (July 2026 audit)

- RLS on all 47 tables; deny-all \`app_secrets\`; owner-only \`audit_log\`.
- Anonymous EXECUTE revoked on all RPCs (ACLs verified:
  authenticated + service_role only).
- No secrets in the repo — committed keys (Supabase anon, FiveManage) are
  public-by-design; \`service_role\` exists only in Supabase's dashboard.
- XSS: React auto-escaping; ONE sanctioned static
  \`dangerouslySetInnerHTML\` (the pref applier); \`safeUrl\` on DB-sourced
  links (unit-tested); the markdown renderer builds elements, never HTML.
- CSV exports formula-injection-guarded (unit-tested).
- CSP: \`default-src 'self'\`, exact connect-src allow-list,
  \`frame-ancestors 'none'\`; \`wasm-unsafe-eval\` (not full eval) for PDFs.
- Authorship unforgeable (stamp triggers + \`create_notification\`);
  self-promotion and self-co-sign trigger-blocked.

## Residual risks / accepted trade-offs

1. **RPC internals are the escalation surface** — \`assign_member\` etc.
   check the caller inside; a bug there = privilege escalation. Review
   any RPC edit line-by-line.
2. \`mo_crossref\` deliberately leaks case *existence* across bureaus (with
   request-access flow) — design, not defect.
3. UI mirrors of server rules (\`canReviewCase\`, audit-owner tab) can
   mislead if they drift — server still refuses, but keep them synced.
4. Rate limiting = Supabase platform defaults; no app-level throttle
   (accepted at this scale).
5. \`bootstrap_command\`/\`bootstrap_director\` RPCs remain from setup —
   drop or verify inert ([Ch. 19](19-improvements.md)).
6. Dashboard-only settings (OTP expiry 30 min, leaked-password
   protection, backups) are the owner's checklist — status in
   \`docs/HARDENING.md\`.

## Rules for contributors

Never weaken \`safeUrl\`/\`humanizeError\`/\`csvCell\`; never bypass \`db.ts\`;
never add an external host without updating the CSP *and* thinking about
what it can exfiltrate; treat any SECURITY DEFINER change as a security
review, not a code review.`,
  },
  {
    slug: "development-workflow",
    title: "Development Workflow",
    section: "Working on it",
    body: `## Local setup

\`\`\`bash
git clone https://github.com/hamadalrumaihi/cid.git
cd cid
cp .env.example .env.local     # public keys, pre-wired to the live project
npm install
npm run dev                    # http://localhost:3000
\`\`\`

Node 22+ and npm are the only prerequisites. \`.env.local\` values are
public-by-design ([Ch. 18](18-security.md)); note that local dev talks to
the LIVE database — RLS still applies to your account, but treat writes as
real.

## The gates (run before every commit)

\`\`\`bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint src --max-warnings 0
npm test            # vitest (security-critical pure functions)
npm run build       # next build — all routes must prerender
\`\`\`

CI (\`.github/workflows/ci.yml\`) runs the same four on every push/PR;
Dependabot opens weekly dependency PRs gated by the same.

## Shipping

Branch from \`main\` → PR → the Vercel bot posts a preview URL (check your
change there) → merge → production tracks \`main\` (atomic alias flip;
instant rollback available in the Vercel dashboard).

## Creating a new feature (the recipe)

1. **Screen**: create \`src/components/<feature>/<Feature>View.tsx\` —
   start by copying a registry view (VehiclesView is the cleanest
   template) and keep its idioms.
2. **Route**: add the tab to \`lib/nav.ts\` (PAGE_META + a category's tabs +
   TAB_LABEL) and the switch in \`app/(app)/[tab]/page.tsx\`.
3. **Data**: if a new table is needed — additive migration on the live
   project, RLS policies (copy the closest pattern in [Ch. 8](08-database.md)),
   realtime publication, FK indexes, then hand-add to
   \`database.types.ts\`.
4. **Docs**: update \`docs/USER-GUIDE.md\` (+ regenerate
   \`src/components/guide/guideContent.ts\`) and this handbook if contracts
   changed.
5. Gates → PR → preview-test the live behavior (two browsers to see
   realtime) → merge.

## Fixing a bug

Reproduce → find the layer ([Ch. 13](13-debugging.md)) → smallest fix →
add/extend a unit test if the bug was in a pure function → gates → PR
with the failure mode described in the commit message.

## Updating dependencies

Dependabot PRs: read the changelog, let CI pass, spot-check the preview
(especially after \`next\`/\`@supabase\` bumps — CSP and auth flows are the
sensitive spots). Majors: update deliberately, one at a time.

## Releases & versioning

[SemVer](https://semver.org) as of **v1.0.0**: MINOR for feature releases,
PATCH for fixes, MAJOR for breaking platform changes. A release PR bumps
\`package.json\` and adds a \`CHANGELOG.md\` entry listing the merged PRs.
Not every merge is a release — group related merges into one entry.

The **merge checklist** lives in \`.github/PULL_REQUEST_TEMPLATE.md\` (gates,
preview verification, permissions, the DB ritual, docs sync, secrets) and
is the definition of done for every PR. The short contributor guide is
\`CONTRIBUTING.md\`; the stabilization audit and readiness scores are in
\`docs/RELEASE-READINESS.md\`.

> **The isolation rule**: all development happens on a branch and is
> verified on its PR preview before merge — production tracks \`main\` and
> deploys immediately. GitHub branch protection is a repository *setting*
> (not verified as configured; see RELEASE-READINESS §7) — until enabled,
> discipline is the guard.

## Database changes — the ritual

Additive SQL → apply to the live project → verify with the Supabase
security/performance advisors → mirror in \`database.types.ts\` (same PR) →
note it in \`supabase/README.md\`'s lineage if it's structural.`,
  },
  {
    slug: "conventions",
    title: "Coding Conventions",
    section: "Working on it",
    body: `These are the patterns the repository **actually uses** — follow them so
your code reads like the code around it.

## Naming & files

- One folder per screen under \`src/components/\`; the main component is
  \`<Feature>View.tsx\`; helpers live beside it (\`caseUtils.ts\`,
  \`announceUtils.ts\`). Shared logic goes in \`src/lib/\` (camelCase files).
- Components and types are PascalCase; helpers camelCase; constants
  SCREAMING_SNAKE (\`PAGE_META\`, \`FORM_SCHEMAS\`, \`CASE_STATUSES\`).
- Imports use the \`@/\` alias (\`@/lib/db\`), never relative \`../../\`.

## Component structure (the registry-view skeleton)

\`\`\`tsx
'use client'
export function FeatureView() {
  const { state, canEdit, canDelete } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const version = useTableVersion('table')

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    setLoading(true); setErr(null)
    try { setRows(await withRetry(() => list('table', { order: 'updated_at', ascending: false }))) }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }, [state])

  useEffect(() => {                                   // the deferred-effect pattern
    const t = setTimeout(() => { void refresh() }, 0) // (or queueMicrotask)
    return () => clearTimeout(t)
  }, [refresh, version])
  …
}
\`\`\`

## Data access

- ONLY through \`lib/db.ts\`. Reads: try/catch (they throw). Writes: check
  \`res.error\` and toast it; for updates where RLS might silently match
  nothing, also check for empty \`data\` (RecordsView is the reference).
- \`withRetry\` for initial loads of important screens; never for writes.
- Privileged/multi-step flows: \`rpc()\` only — never re-implement
  client-side.
- Deletes: \`uiConfirm\` (or \`deleteWithUndo\`'s built-in confirm) + Undo;
  configure \`children\`/\`setNullRefs\` to match the FK schema.

## Effects & async

- State-setting effects defer via \`setTimeout(0)\`/\`queueMicrotask\`
  (lint-clean, deterministic prerender).
- Overlapping fetches get a sequence guard (\`seq\` counter) or \`cancelled\`
  flag.
- No \`Date.now()\`/randomness during render — stamp a \`loadedAt\` in the
  fetch and derive from state (analytics/heatmap do this).

## Modals & forms

- Modals mount fresh per open; field state seeds from props (no reset
  effects). Provide \`dirty()\` so Modal can guard discards.
- Validate lightly (required fields → warn toast); let the database
  enforce real constraints and \`humanizeError\` translate them.
- Busy-guard submit buttons (\`disabled={busy}\`) — double-submit was a
  real bug class.

## Security idioms

- \`safeUrl()\` on EVERY DB-sourced href/src. No \`dangerouslySetInnerHTML\`
  (one sanctioned static exception in \`app/layout.tsx\`).
- Never select \`profiles.email\` outside command paths (\`PROFILE_COLS\`).
- FK-preservation: when an edit form's select options may not include the
  currently-linked row (stale cache/restricted), render a synthetic
  "(current … — loading…)" option so saving can't null the link.

## Styling

- Tailwind utilities inline; theme tokens from \`globals.css\` (\`ink-*\`,
  \`badge-500\`). **Blue utilities are accent-remapped** — \`text-blue-300\`
  renders in the user's chosen accent; that's intended.
- Notices/empty states: the themed ALL-CAPS "// " style; loading and
  error notices use the shared card look.

## Comments & commits

- Comments state constraints the code can't show ("email is command-only
  — updateNoSelect required"), often citing the vanilla origin. No
  narration.
- Commits: \`type(scope): summary\` (\`feat(indicators): …\`,
  \`chore(hardening): …\`) with a body explaining behavior, not diffs.`,
  },
  {
    slug: "best-practices",
    title: "Best Practices",
    section: "Working on it",
    body: `## Always

- **Trust the database, not the client.** Add/extend RLS first; UI gates
  second. If a rule matters, it must exist in SQL.
- **Surface every write failure.** \`res.error\` → toast; empty-data
  updates → warn. Silence is the enemy (this repo's worst historical bugs
  were silent no-ops).
- **Keep migrations additive** and move \`database.types.ts\` in the same
  PR.
- **Copy the nearest good pattern.** The registry-view skeleton, the
  refresh idiom, FK-preservation options, sequence guards — they exist in
  ~10 places each; consistency IS the maintainability strategy.
- **Run the four gates before pushing** — CI will catch you anyway, but
  slower.
- **Give destructive actions an Undo** (\`deleteWithUndo\`) and a confirm.
- **Test realtime with two browsers** when you touch data flows.

## Never

- Never put the \`service_role\` key anywhere in this repo or bundle.
- Never write sign-off/finalize/role columns directly — RPCs only
  (triggers will reject you anyway; don't fight them).
- Never \`dangerouslySetInnerHTML\`, \`innerHTML\`, or unsanitized hrefs.
- Never auto-retry a mutation.
- Never rename \`Store\` keys or nav slugs casually — they're contracts
  (legacy app, deep links).
- Never edit \`guideContent.ts\` by hand (generated) or let it drift from
  \`docs/USER-GUIDE.md\`.
- Never "clean up" the deferred-effect pattern, Modal's ref-routing, or a
  sequence guard because it looks redundant — each fixes a real bug.

## Patterns worth imitating (real examples)

| Pattern | Where to see it |
|---|---|
| Zero-rows-means-blocked surfaced as a warning | \`RecordsView.save\` |
| Delete-then-reinsert children with rollback on partial failure | \`NarcoticsView\` save |
| Scan failure ≠ "no matches" (no false negatives) | \`VehiclesView\` cross-ref panel |
| Compare-and-swap so two tabs can't double-fire | \`CasesView\` stale escalation |
| Partial-tolerant aggregation ("a partial packet beats none") | \`lib/packet.gatherCasePacket\` |
| Server-stamped identity (unforgeable authorship) | \`create_notification\` RPC + stamp triggers |
| Public-data honesty (existence-only leak, explicit stubs) | Indicators 🔒 stubs, \`mo_crossref\` |`,
  },
  {
    slug: "change-impact",
    title: "Change Impact Guide",
    section: "Working on it",
    body: `| If I change… | Also check… | Why |
|---|---|---|
| A table's schema (live migration) | \`database.types.ts\` (hand-add), \`select\` projection strings (grep the column), RLS policies, realtime publication, FK index | Types don't auto-regen; projections fail at runtime; new tables are invisible without policies, stale without publication |
| \`PAGE_META\` / adding a screen | Category tabs + \`TAB_LABEL\` + the \`[tab]\` switch; guide screen-count + regeneration | The three-way nav contract + docs ([FAQ](appendix-faq.md) has the recipe) |
| \`lib/db.ts\` contract | Every view's read try/catch and write \`res.error\` check | Throw-vs-return is assumed app-wide |
| \`useAuth\` shape / capability booleans | ~40 consumers, Gate branches | canEdit/canDelete gate every button |
| An RLS policy or \`private.*\` helper | The matching UI gates, \`useNavBadges.canReviewCase\`, zero-rows checks | UI mirrors must match or users see phantom buttons/badges |
| Sign-off RPCs / routing | \`lib/signoff.ts\` labels, CaseDetail Sign-off tab, \`useNavBadges\`, \`notifText\` types | Vocabulary + mirror + notifications track the server states |
| \`FORM_SCHEMAS\` field keys | Saved \`reports.fields\` JSON (old reports must still render), \`formToText\`, warrant matching | Field keys ARE the storage format |
| A case-satellite FK / cascade | \`CaseDetail\` delete config; \`GangsView\`/\`PlacesView\`/\`PersonsView\` children/setNullRefs | Undo restores exactly what the config lists |
| \`Store\` keys | The legacy vanilla app, \`page.tsx\` deep-link shim, the pre-hydration \`PREF_APPLIER\` | Shared localStorage blob = cross-app contract |
| \`globals.css\` accent remap / \`.nav-collapsed\` | Sidebar collapse logic, \`PREF_APPLIER\`, AppearanceModal | The class/dataset contracts live in three places |
| CSP (\`next.config.ts\`) | PDF export (WASM), Supabase REST+WSS, FiveManage, Discord | The allow-lists are exact |
| \`docs/USER-GUIDE.md\` | Regenerate \`guideContent.ts\` | Dual-copy system |
| An environment variable | \`vercel.json\` AND \`.github/workflows/ci.yml\` | Duplicated values must agree; \`NEXT_PUBLIC_\` values need a rebuild |
| A user's role (data, not code) | Their bureau/active flags via the Roster screen only | \`assign_member\` RPC is the sole write path (trigger-enforced) |
| Component props on a shared UI primitive | All call sites (grep the import) — especially \`Modal\`'s \`dirty\`/\`onClose\` contract | Focus/scroll/discard behavior is relied on everywhere |`,
  },
  {
    slug: "debugging",
    title: "Debugging Guide",
    section: "Working on it",
    body: `## Where to look, in order

1. **Browser DevTools console** — the app logs nothing routinely, so any
   console error is signal. Network tab: filter \`rest/v1\` to see every
   query/RPC and its response (RLS denials come back as HTTP errors or
   empty arrays).
2. **The toast** — every surfaced failure passes \`humanizeError\`. "You
   don't have permission…" = RLS; "already exists" = unique violation.
3. **Supabase Dashboard → Logs** — API, Postgres and Auth logs; the place
   to see the *server's* reason for a refusal.
4. **\`audit_log\`** (owner account, Oversight → Audit) — every mutation on
   20 tables with actor + payload. Great for "who changed this?".
5. **Vercel deployment logs** — build failures only (no runtime server).

## Common bugs and their usual causes

| Symptom | Likely cause | Check |
|---|---|---|
| Button click "does nothing" | A mutation's \`{error}\` is being discarded, or RLS blocked an UPDATE (zero rows, no error) | Network tab for the PATCH; does the caller check \`res.error\` AND empty \`data\`? (\`RecordsView.save\` is the reference pattern) |
| Screen never updates until reload | Table missing from the realtime publication, or the view lacks \`useTableVersion\` in its effect deps | [Ch. 8.6](08-database.md); grep the view for \`useTableVersion\` |
| A screen shows nothing but no error | RLS scope — you're signed in as the wrong bureau/role, or the profile is inactive | Try a command account; check \`profiles.active\` |
| "Could not load: …" notice | The read threw (network, or RLS on a *joined* table) | Network tab; reads are allowed to fail loudly by design |
| New tab/screen 404s or redirects to /command | The nav three-way contract is incomplete | PAGE_META + category tabs + TAB_LABEL + the \`[tab]\` switch |
| Modal loses focus / re-mounts mid-edit | Someone changed Modal's effect deps or removed the ref-routing | \`ui/Modal.tsx\` header comment — deps must stay \`[open]\` |
| Types say a column exists but runtime is \`undefined\` | \`database.types.ts\` drifted from the live schema, or a \`select\` projection omits the column | Compare with the live table; grep the projection strings |
| PDF export dies with a WASM/CSP error | CSP \`script-src\` lost \`wasm-unsafe-eval\` | \`next.config.ts\` |
| Sign-in loops or lands signed-out | \`/\` redirected before the token was consumed | \`app/page.tsx\` must wait for the auth event — don't "simplify" it |
| Duplicate toasts / double realtime | A second channel was opened outside \`subscribeTable\` | \`lib/realtime.ts\` registry |
| Wrong colors (blue renders amber) | Not a bug — the accent remap in \`globals.css\` rewrites blue-* utilities | [Ch. 15](15-conventions.md) |

## Safe debugging workflow

1. Reproduce against a **preview deployment** or \`npm run dev\` — never
   experiment against production data with a command account you don't
   need.
2. Read the failing request in the Network tab FIRST (URL, payload,
   response) — it usually names the table/policy at fault.
3. If it smells like RLS, test the same query in the Supabase SQL editor
   with \`set role authenticated; set request.jwt.claims …\` or simply
   compare two accounts of different roles.
4. Fix with the smallest change, then run the four gates
   (\`npm run typecheck && npm run lint && npm test && npm run build\`).
5. If the fix touches the database: **additive migration**, update
   \`database.types.ts\`, re-check the security advisors.

## Debugging don'ts

- Don't add the \`service_role\` key ANYWHERE client-side to "see past" RLS.
- Don't auto-retry mutations while diagnosing (double-writes).
- Don't strip a sequence guard because "it works without it" — it works
  until requests overlap.`,
  },
  {
    slug: "performance",
    title: "Performance Notes",
    section: "Working on it",
    body: `## Already good

Static pre-rendering (instant first paint); React Flow and @react-pdf are
dynamic-imported (out of the main bundle); 68 FK covering indexes +
pg_trgm search indexes server-side; one realtime channel per table;
memoized heavy derivations; slim \`select\` projections on picker queries.

## Known considerations, in priority order

1. **Whole-table refetch on every change.** The version-counter pattern
   refetches entire tables per subscribed view on any single row change.
   Fine at division scale (hundreds of rows); will not scale to tens of
   thousands. The upgrade path (server-side pagination/filtering) is
   parked in \`docs/DEFERRED.md\` — revisit at ~10× data.
2. **Client-side scanners.** The vehicles cross-ref scan is
   O(vehicles × cases) with regexes over report text; InboxView JSON-scans
   messages for mentions. Bounded today (limits on messages); keep limits
   when touching them.
3. **Large files as edit-risk hotspots**: \`GangsView\` (~690 lines) — and
   formerly \`CaseDetail.tsx\`, whose 12 lazy-fetching tabs were split into
   one file each (\`cases/tabs/\`) in v1.1.0. Runtime is fine; review
   care isn't.
4. **Re-render sources**: the 1s tick in Trackers (small, fine);
   AuthProvider re-rendering on hourly token refresh (mitigated by
   Modal's ref design — preserve it).
5. **Images**: external mugshots/media are plain \`<img>\` — no next/image
   optimization for arbitrary hosts. Acceptable; know it.
6. **Non-published tables** (\`feedback\`, \`watchlist\`, \`operations\`)
   refresh on remount only — deliberate trade, not a bug.`,
  },
  {
    slug: "improvements",
    title: "Improvement Ideas",
    section: "Working on it",
    body: `Recommendations only — nothing here is implemented. Effort: S < 1d,
M = days, L = week+.

## Quick wins (S)

| Idea | Why / benefit | Risk |
|---|---|---|
| Drop unused deps (\`react-hook-form\`, \`zod\`*, \`@tanstack/react-query\`) | Zero imports; smaller install/audit surface | none |
| Drop/verify \`bootstrap_*\` RPCs | Close a setup-era privileged path | none (verify first) |
| Wire or delete \`lib/drafts.ts\` | It's good never-lose-work code with zero importers | none |
| Script + CI check for \`guideContent.ts\` generation | Kills a proven drift class | none |
| Fix the guide's hardcoded case-tab illustration | Already drifted from the real tabs | none |
| Fold \`chargeByCode\` into \`penalByCode\`; migrate off deprecated \`roles.isCommand\` | Naming hygiene | trivial |

*or keep zod and use it — see below.

## Medium improvements (M)

| Idea | Why / benefit | Risk |
|---|---|---|
| **Commit the SQL schema** (\`schema.sql\` dump + migration log for post-folder changes) | Today the live DB is the only source of truth — no reviewable history | none |
| ~~**Split \`CaseDetail.tsx\`** into per-tab files (keep the \`RicoTab\` export)~~ **done v1.1.0** — tabs live in \`cases/tabs/\` | The hottest, biggest file becomes reviewable | low (gates cover it) |
| **Type the JSON columns** (\`reports.fields\`, \`media.tags\`, \`cases.charges\`, announcement mentions/links) with zod at the read boundary | Today's casts hide shape drift | low |
| Extract a \`useRegistry\` hook from the ~10× repeated registry skeleton | Hundreds of duplicated lines; new registries in minutes | medium — migrate incrementally |
| Nonce-based CSP (drop \`unsafe-inline\` scripts) | Defense in depth | medium (Next runtime quirks) |
| Accessibility pass on color-only heat tints; keyboard path for board moves | A11y gaps found in review | low |

## Long-term (L)

| Idea | Why / benefit | Risk |
|---|---|---|
| **RLS/RPC test suite** (pgTAP or vitest against a Supabase branch with two test users) | The security wall has zero automated coverage — highest-value testing investment | low |
| Server-side pagination/filtering for cases & audit (from DEFERRED.md) | Removes the whole-table-refetch ceiling | medium — touches the refresh idiom |
| Component/E2E smoke tests (sign-in → create case → sign-off) | Catches integration regressions CI can't | low |

## By theme

- **Technical debt**: schema-in-repo, CaseDetail split, unused deps,
  drafts.ts, registry-hook extraction.
- **Performance**: pagination (when data grows), scanner bounds.
- **Security**: RLS tests, bootstrap RPC removal, nonce CSP, dashboard
  checklist completion (\`HARDENING.md\`).
- **DX**: guide generation script, JSON typing, more unit tests around
  pure domain logic (penal totals, matchKey).
- **UX/A11y**: heat-tint labels, keyboard board moves, notification
  mute preferences, mark-all in the bell.
- **Scalability**: pagination + selective realtime payloads (use the
  event's row data instead of refetching) — a natural pair.`,
  },
  {
    slug: "glossary",
    title: "Glossary",
    section: "Reference",
    body: `Plain-English definitions of every technical term the handbook uses.

| Term | Meaning here |
|---|---|
| **Component** | A reusable piece of UI written as a function returning HTML-like markup (JSX). \`<CaseBoard />\` is a component. |
| **Props** | The inputs a component receives, like function arguments. |
| **State** | Data a component remembers between renders (\`useState\`). Changing it re-renders the component. |
| **Hook** | A \`use…\` function that gives a component access to React features. Custom hooks (\`useTableVersion\`) bundle reusable behavior. |
| **Effect** | Code that runs after render (\`useEffect\`) — used here for data fetching. House rule: defer state-setting effects via \`setTimeout(0)\`. |
| **Context / Provider** | React's way to share a value (like "who is signed in") with every component underneath, without passing props down each level. |
| **Store (zustand)** | A small global state container outside the component tree — needed so non-React code (the data layer) can push toasts. |
| **\`Store\` (this repo)** | Confusingly also the name of the localStorage wrapper (\`lib/store.ts\`) for device preferences. Unrelated to zustand. |
| **Route / Page** | A URL the app responds to. One dynamic route (\`[tab]\`) serves all 29 screens. |
| **API / Endpoint** | An HTTP URL a program calls. Here: Supabase's auto-generated \`/rest/v1/<table>\` and \`/rest/v1/rpc/<fn>\`. |
| **SQL / Postgres** | The database language / the database engine Supabase hosts. |
| **Query** | A request for data (SQL SELECT, or the \`list()\` helper). |
| **Migration** | A versioned SQL script changing the database's shape. Additive-only in this project. |
| **RLS (Row Level Security)** | Postgres policies deciding, per row and per user, whether SELECT/INSERT/UPDATE/DELETE is allowed. The heart of this app's security. |
| **Policy** | One RLS rule on one table for one operation. |
| **Trigger** | SQL that runs automatically before/after a row changes — used for audit logs, timestamps, and blocking protected columns. |
| **RPC** | Calling a named database function over HTTP — used for atomic, permission-checked, multi-step operations. |
| **SECURITY DEFINER / INVOKER** | Whether a database function runs with its owner's privileges (definer — then it must check the caller itself) or the caller's (invoker). |
| **JWT / Session** | A signed token proving who you are; stored by the Supabase client and attached to every request, auto-refreshed hourly. |
| **Realtime / Subscription / Websocket** | Supabase pushes a message over a persistent connection when a table changes; the app turns these into version counters. |
| **Promise / async–await** | JavaScript's way to handle operations that finish later without freezing the page. |
| **Cache** | Kept-around data to avoid refetching. Here: the profiles cache, localStorage, browser HTTP cache — deliberately no general data cache. |
| **Webhook** | A call a service makes *to you* on an event — used only by the dev workflow (GitHub→CI), not the app. |
| **CSP (Content-Security-Policy)** | A response header allow-listing what the page may load/connect to. Lives in \`next.config.ts\`. |
| **Anon / publishable key** | The Supabase client key shipped in the bundle. Public by design — it grants nothing RLS doesn't allow. |
| **service_role key** | The Supabase key that BYPASSES RLS. Never in this repo, never in the client. |
| **Hydration** | React attaching interactivity to server-rendered HTML. The theme applier runs pre-hydration to avoid a flash. |
| **Portal** | Rendering a component outside its parent DOM node (modals/toasts render into \`<body>\`). |
| **Sequence guard** | A counter/flag ensuring only the newest async request's result is applied. |
| **CAS (compare-and-swap)** | An update that only applies if a column still has an expected value — prevents two tabs double-firing. |
| **pg_trgm** | The Postgres extension powering typo-tolerant search. |
| **Bureau** | A sub-division (\`LSB\`/\`BCB\`/\`SAB\`/\`JTF\`); most case access is scoped to it. |
| **Sign-off chain** | The server-routed approval flow: bureau lead → deputy director → director. |
| **Deconfliction** | Detecting the same identifier/person across separate cases. |
| **BOLO** | "Be on the lookout" — flagged persons. |
| **RICO / predicate act** | The racketeering case wrapper and its qualifying acts. |
| **Packet / dossier** | The court-ready case export / the per-person export. |`,
  },
  {
    slug: "quick-reference",
    title: "Quick Reference",
    section: "Reference",
    body: `## Commands

\`\`\`bash
npm run dev          # local dev server (http://localhost:3000)
npm run build        # production build — all routes must prerender
npm start            # serve the production build
npm run typecheck    # tsc --noEmit
npm run lint         # eslint src --max-warnings 0
npm test             # vitest run
# the pre-push ritual:
npm run typecheck && npm run lint && npm test && npm run build
\`\`\`

Deploy = merge to \`main\` (Vercel tracks it; PRs get preview URLs;
rollback via Vercel dashboard → Deployments → Rollback).

## Environment variables (all public; committed in vercel.json + ci.yml)

| Variable | Purpose |
|---|---|
| \`NEXT_PUBLIC_SUPABASE_URL\` | Project API URL (required) |
| \`NEXT_PUBLIC_SUPABASE_ANON_KEY\` | Publishable key (required; RLS is the boundary) |
| \`NEXT_PUBLIC_FIVEMANAGE_API_KEY\` | Upload key (optional — uploads off without it) |
| \`NEXT_PUBLIC_FIVEMANAGE_BASE_URL\` | FiveManage host (optional) |

## Roles & capability booleans

| Tier | Roles | canEdit | canDelete/isCommand |
|---|---|---|---|
| (inactive) | any, \`active=false\` | ✗ | ✗ |
| Member | detective, senior_detective | ✓ | ✗ |
| Command | bureau_lead, deputy_director, director | ✓ | ✓ |

Bureaus: \`LSB\` · \`BCB\` · \`SAB\` · \`JTF\`. Sign-off chain:
bureau_lead → deputy_director → director.

## The db.ts contract

| Helper | Errors |
|---|---|
| \`list\`, \`custodyForCase\` | **throw** — wrap in try/catch |
| \`insert/update/updateWhere/updateNoSelect/remove/removeWhere/rpc\` | **return \`{error}\`** — check it; empty-data update = blocked |
| \`withRetry\` | reads only |
| \`deleteWithUndo\` | confirm + 6s Undo; configure \`children\`/\`setNullRefs\` |

## Main RPCs

\`search_all\` · \`signoff_submit/decide/owner_action\` · \`report_finalize\` ·
\`assign_member\` · \`admin_member_emails/remove/restore\` ·
\`create_notification\` · \`mo_crossref\` ([Ch. 7](07-api.md)).

## Database tables (47), by RLS pattern

- **Case-scoped**: cases, case_assignments, evidence, custody_chain,
  reports, case_tasks, case_messages, case_intel_links, case_files,
  case_signoff_history, rico_cases, predicate_acts, mo_profiles,
  raid_compensations, trackers, case_access_grants/requests,
  case_templates
- **Shared intel**: persons, gangs, gang_ranks, gang_members, gang_turf,
  vehicles, places, place_process_steps, narcotics, narcotic_precursors,
  narcotic_hotspots, ballistics_benches, ballistic_footprints, indicators,
  media, cid_records, operations, tickets, commendations, documents,
  documents_versions
- **Own-row**: notifications, watchlist, shift_reports, feedback, profiles
- **System**: audit_log, announcements, app_secrets

## Remaining enums

\`assign_role\`: primary/support · \`report_kind\`: initial/supplemental/
followup · \`evidence_tamper\`: intact/compromised/released/destroyed ·
\`media_type\`: image/video/fivemanage/document · \`doc_kind\`:
doc/sheet/pdf/zip · \`location_type\`: drug_lab/stash_house/dead_drop/
front_business/chop_shop · \`bench_type\`: street/organized ·
\`tracker_status\`: pending/authorized/expired · \`threat_level\`/\`density\`:
low/medium/high.

## Keyboard shortcuts (in-app)

\`/\` focus search · \`Ctrl/⌘-K\` command palette · arrows+Enter in palette ·
Enter submits quick-add rows.

## localStorage keys (the \`cid-portal-v3\` blob — legacy-shared, don't rename)

\`tab\` · \`collapsed\` · \`accent\` · \`density\` · \`annSeen\` · \`annDismissed\` ·
\`casesScope\` · \`casesView\` · \`caseFilters\` · \`caseViews\` · \`recentCases\` ·
\`pinnedCases\` · \`benchType\` · \`watchSeen\` · \`recentSearches\` ·
\`graphLayout:<caseId>\`.`,
  },
  {
    slug: "faq",
    title: "FAQ",
    section: "Reference",
    body: `**Where should I add a new page/screen?**
Four places, all required: (1) \`src/components/<feature>/<Feature>View.tsx\`
(copy \`VehiclesView\` as a template); (2) \`src/lib/nav.ts\` — a \`PAGE_META\`
entry, the slug in a category's \`tabs\`, a \`TAB_LABEL\`; (3) the switch in
\`src/app/(app)/[tab]/page.tsx\`; (4) \`docs/USER-GUIDE.md\` + regenerate
\`guideContent.ts\`. Miss (2) or (3) and the tab redirects or renders a
placeholder. Full recipe: [Ch. 14](14-development-workflow.md).

**How do permissions work?**
Three layers: \`useAuth()\`'s booleans hide buttons (cosmetic), RLS policies
refuse rows (the real wall), guard triggers lock specific columns even for
allowed writers. If a rule matters, put it in SQL first. [Ch. 9](09-auth.md).

**Where are the database queries?**
Only in \`src/lib/db.ts\` calls inside each view (\`list\`, \`insert\`, …).
There is no other query layer — no ORM, no /api routes. Reads throw;
writes return \`{error}\`. [Ch. 3, Block 4](03-architecture.md).

**Where do I change navigation?**
\`src/lib/nav.ts\` (the model) and \`src/components/shell/\` (the rendering).
Never rename existing slugs — they're deep-link contracts.

**Where are environment variables used?**
Only \`src/lib/supabase.ts\` and \`src/lib/fivemanage.ts\`. Values are
duplicated in \`vercel.json\` and \`.github/workflows/ci.yml\`. All public;
changing one requires a rebuild. [Quick Reference](appendix-quick-reference.md).

**How do I add a new feature with a new table?**
Additive migration on the live project → RLS policies (copy the closest
pattern) → realtime publication → FK indexes → hand-add to
\`database.types.ts\` → build the view → wire nav → docs. [Ch. 14](14-development-workflow.md).

**Why does my write "succeed" but change nothing?**
RLS blocked it: mutations return \`{error}\` OR zero rows with no error.
Check \`res.error\` and, for updates that might be scope-blocked, empty
\`data\` (see \`RecordsView.save\`). [Ch. 13](13-debugging.md).

**Why doesn't my screen update live?**
Either the table isn't in the realtime publication ([Ch. 8.6](08-database.md))
or the view's effect deps don't include \`useTableVersion('table')\`.

**Why is everything blue-classed but rendering amber?**
The accent system: \`globals.css\` remaps blue-* utilities to the user's
chosen accent. Intended. [Ch. 15](15-conventions.md).

**Where is the sign-off logic?**
In the database (\`signoff_*\` RPCs + \`private.signoff_route/pick\`). The
client only calls RPCs and renders vocabulary from \`lib/signoff.ts\`.
Don't implement chain logic client-side — triggers reject direct writes.

**How do notifications get created?**
Only via \`lib/notify.ts\` → the \`create_notification\` RPC (the actor is
stamped server-side; failures are deliberately swallowed). Rendering
vocabulary: \`lib/notifText.ts\`.

**What should I avoid changing first?**
\`CaseDetail.tsx\`, \`lib/db.ts\`, \`lib/auth.tsx\`, \`globals.css\`'s accent/
collapse blocks, \`next.config.ts\` (CSP), anything under \`supabase/\` —
learn steps 1–6 of the [Learning Path](20-learning-path.md) first. Safe
starter areas: \`PenalView\`, \`GuideView\`, any registry view.

**Where do I put temporary/draft user input?**
Modals guard dirty state automatically. For persistence there's
\`lib/drafts.ts\` — currently unwired (zero importers) — or the \`Store\`
blob for preferences. Don't invent a third mechanism.

**How do I test realtime behavior?**
Two browsers (or one normal + one incognito) signed in as different
users; change data in one, watch the other. Preview deployments work too.

**Who can delete things?**
Command only, everywhere (RLS \`can_delete()\`), always with Undo. If Undo
restores a parent without its children, the \`deleteWithUndo\` cascade
config is missing entries — fix the config, not the pattern.`,
  },
]
