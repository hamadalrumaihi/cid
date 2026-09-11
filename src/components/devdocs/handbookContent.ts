/** GENERATED from docs/handbook/*.md by scripts/generate-handbook.mjs.
 *  DO NOT EDIT — edit the markdown and run `npm run gen:handbook`.
 *  CI verifies this file matches the markdown. */

export interface HandbookPage {
  slug: string
  title: string
  section: string
  body: string
}

export const HANDBOOK_UPDATED = '2026-09-11'

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
**bureau** — \`major_crimes\` (Major Crimes), \`street_crimes\` (Street Crimes), or
\`JTF\` — and case visibility is bureau-scoped (\`special_investigations\` marks
SIB-authority cases).

## Main workflows

1. **Run a case**: create → log evidence/reports/tasks/charges → link intel
   → submit for sign-off → export the court packet ([Ch. 4.1](04-features.md)).
2. **Build intelligence**: registries for persons, gangs, vehicles, places,
   indicators — cross-referenced automatically (deconfliction alerts).
3. **Command oversight**: the Command Center (approvals, promotions,
   case & intelligence oversight queues), Division Overview vitals,
   analytics, heatmap, announcements, GPS-tracker co-signing.
4. **Personal dashboard**: My Dashboard (the default landing —
   everything waiting on *you* at a glance), watchlist, calendar,
   weekly shift reports, notifications.

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
| **Next.js 16** (App Router) | One dynamic \`[tab]\` route renders every screen; everything pre-renders to static HTML for instant loads; zero-config Vercel deploys. |
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
  Guides → Portal User Guide). *Why*: you can't debug flows you've
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
that renders every screen; \`error/global-error/not-found.tsx\` are the
crash/404 screens; \`globals.css\` holds the entire design system.
**Connected to**: everything renders inside it; reads \`lib/nav\` for valid
tabs. Details: [Ch. 5](05-pages.md).

### \`src/components/shell/\` — the chrome
The persistent frame around every screen: \`Sidebar\`, \`Header\` (global
keyboard shortcuts), \`BottomNav\` (mobile), \`Subtabs\`, \`SearchPalette\`
(⌘K), \`NotificationsBell\`, \`ConnBanner\` (offline pill), appearance/profile
modals, and the \`useNav\`/\`useNavBadges\` hooks. **Why it exists**: one
navigation implementation instead of one per screen. Details: [Ch. 6](06-components.md).

### \`src/components/ui/\` — generic widgets
\`Modal\` (focus trap + dirty guard), \`dialog\` (confirm/prompt), \`Toaster\`,
\`DataTable\` (sort/filter/CSV), \`RichEditor\` (Tiptap), and since v1.14
\`WorkflowTimeline\` (history render) and \`DeadlineChip\` (shared deadline
vocabulary). Feature-agnostic — every feature folder builds on these.
\`src/components/shared/\` holds the cross-feature record widgets extracted
from the DOJ build (\`RelatedRecordPicker\`, \`VersionViewer\`,
\`SignatureViewer\`) plus the entity-select set (\`RecordSearchPicker\` +
\`useListboxNav\`, \`LinkedPersonPanel\`) — see [Ch. 6](06-components.md).

### \`src/components/<feature>/\` — the feature folders
One folder per screen (\`cases/\`, \`gangs/\`, \`heatmap/\`, …). Each is
self-contained: fetches its own data, owns its modals. Only the \`[tab]\`
router imports them — except the 14 intelligence tool views, which are
imported (code-split) by \`tools/toolRegistry.tsx\` instead: \`tools/\` is the
Investigative Tools workspace (\`/workspace?tool=…\`) that hosts them as
keep-alive tabs, and the legacy \`/tools\` and per-tool routes redirect into it
(\`LEGACY_REDIRECT_TABS\`). \`cases/\` and \`command-center/\` are the
big ones. Details: [Ch. 4](04-features.md).

### \`src/lib/\` — the shared foundation ⭐
30+ files defining every contract the features obey: the data layer
(\`db.ts\`), auth (\`auth.tsx\`), realtime (\`realtime.ts\`), navigation model
(\`nav.ts\`), domain logic (sign-off, the central status registry
(\`status.ts\`), forms, penal code, exports, search, notifications), the
per-user personalization layer (\`pins\`, \`recents\`, \`userDrafts\`,
\`savedViews\` — over the owner-only \`user_pins\`/\`user_drafts\`/\`user_prefs\`
tables), and utilities (toast, format, safeUrl, markdown, store).
**Read this folder before touching features.** Details: [Ch. 3](03-architecture.md),
[File Index](appendix-file-index.md).

### \`supabase/\` — the backend's paper trail
\`migrations/\` (the migration lineage, replayed in filename order by \`supabase db reset\`; note that
later changes were applied directly to the live project — the live schema
is the source of truth), \`functions/\` (the Deno edge
functions — discord-announce, discord-notify, sops-sync), and backend READMEs. Details: [Ch. 8](08-database.md).

### \`docs/\` — documentation
This handbook (\`handbook/\`), \`USER-GUIDE.md\` (a signpost — the user guide
itself is a guide in the library, \`src/components/guides/docs/userGuideDoc.ts\`,
and the old generated copy is
**generated from it**), \`archive/HARDENING.md\` (the historical security checklist),
\`DEFERRED.md\` (parked work with triggers). Historical build-era notes and
dated reports (HANDOFF, ROADMAP, REACT-PARITY, BACKLOG, RELEASE-READINESS,
the audit reports…) are parked in \`archive/\` — see \`archive/README.md\`.

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
\`src/app/*\`, \`src/components/shell/*\`, \`src/lib/nav.ts\`,
\`src/lib/toolsModel.ts\`, \`src/components/tools/*\`
- **Responsibility**: URL ↔ screen; the constant chrome; nav metadata.
- **Data flow**: URL → \`[tab]/page.tsx\` switch → feature view inside
  \`AppShell\`; \`useNavBadges\` computes the Command-button badges.
- **Risk: MEDIUM-HIGH.** \`nav.ts\` is a three-way contract (PAGE_META keys
  = URL slugs = TAB_LABEL keys) plus the \`[tab]\` switch.
- **Investigative Tools**: the former Intelligence category's 14 tabs are
  one workspace (\`/workspace?tool=…\`, the tool directory under Investigations) in both CID and SIB sidebars. \`toolsModel.ts\` is
  the data-only model (\`TOOL_TABS\`, \`TOOL_GROUPS\`, record deep-link params,
  \`RECORD_TAB_TOOLS\`, RLS title sources); \`components/tools/\` renders it —
  directory + keep-alive tab strip (\`ToolsView\`: open tabs stay mounted,
  inactive \`display:none\`), the lazy per-tool registry (\`toolRegistry\`),
  and the \`ToolTabRedirect\` shim the legacy \`/{tool}\` routes render (query
  params carried over, so old deep links survive). Open tabs persist in
  sessionStorage per user as **ids only** and restore with titles
  re-fetched through the RLS-scoped client (invisible rows close silently).
- **Common mistakes**: adding a screen to PAGE_META but not the switch
  (renders a placeholder) or not a category (unreachable from the sidebar);
  importing a tool view from the \`[tab]\` page instead of \`toolRegistry\`
  (double-ships the chunk and bypasses the workspace).

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
  reads-only; \`remove()\` on a soft-deletable table is \`soft_delete\`, and
  \`deleteRecord\` is the one delete helper (Undo = \`restore_record\`; Ch. 22).
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
\`src/lib/{signoff,status,forms,penal,packet,pdf,docx,search,notify,notifText,notifications,watchlist,pins,recents,userDrafts,savedViews,entityPreview,operations,fivemanage}.ts\`
- **Responsibility**: business logic shared across views — sign-off
  vocabulary (read-only interpreter; the chain is SQL!), the central status
  registry (\`status.ts\` — label/tint/meaning/next-actor for every status
  vocabulary, rendered via \`ui/StatusBadge\`), report schemas, penal
  calculators, the export pipeline, search, notifications (shared
  mark-read/unread-count/mute actions in \`notifications.ts\`), and the
  per-user personalization layer: \`pins.ts\` (\`user_pins\`), \`recents.ts\`
  (device-local ids-only trail), \`userDrafts.ts\` (\`user_drafts\` autosave),
  \`savedViews.ts\` (\`user_prefs\`) — all ids-only where records are
  referenced, titles re-resolved through the viewer's RLS at render.
- **Risk: MEDIUM.** Mostly pure functions.
- **Common mistakes**: renaming a \`FORM_SCHEMAS\` field key (orphans saved
  report data); making \`signoff.ts\` *decide* anything; adding a status
  vocabulary as ad-hoc chip classes instead of a \`status.ts\` domain;
  storing titles/labels in pins, recents or any personalization row.

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
RLS on every table, \`private.*\` helper predicates and trigger functions,
all workflow writes through SECURITY DEFINER RPCs, realtime publication on
most tables (live counts: \`npm run check:schema\` / the schema snapshot).
Per-user personalization lives in three owner-only tables (\`user_pins\`,
\`user_drafts\`, \`user_prefs\` — \`20260826010000_ux_personalization.sql\`):
RLS admits only the owner, no audit triggers, no realtime, size-capped
jsonb. The same migration added \`private.audit_detail()\` (old/new row
snapshots into \`audit_log.detail\` on the relationship-link tables), the
\`case_intel_links\` UPDATE policy, the \`create_notification\` 1-hour
identical-unread dedupe guard, and the \`search_all\` bolo/task arms.
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
\`sortValue\`, hidden \`searchText\`); pagination + page-size options; sticky
header; row selection (shift-range, select-all, disabled rows) for bulk
actions; \`mobileCard\` narrow fallback; keyboard-activatable rows; CSV
export guarded against formula injection (\`csvCell\`, unit-tested). Used by
AuditView, CasesView and PersonsView.
**Reuse when**: any tabular list — don't hand-roll another table.

## \`ui/RichEditor.tsx\`
Tiptap v3, **markdown in / markdown out** — storage stays plain text so
\`renderMarkdown\`, exports, and the legacy app all still work. \`value\` is
initial-only; mount fresh per session. **Reuse when**: any long-text field
that renders as markdown elsewhere.

## The v1.14 shared set (extracted from the DOJ build)
Each of these was proven inside the legal-review UI and extracted once it
had two or more non-DOJ consumers. **Reuse them for any new adopter** —
don't re-inline the pattern.

- **\`ui/WorkflowTimeline.tsx\`** — the vertical actor/action/note history
  render. Used by: legal request History tab, case sign-off history
  (SignoffTab), evidence custody chain (Evidence & Media tab, MediaTab.tsx), the
  Command Center approval-queue history, and the CID + Justice
  membership-request applicant history panels. **Reuse when**: any
  append-only history needs displaying.
- **\`shared/RelatedRecordPicker.tsx\`** — case-scoped record lookup/attach.
  Used by: legal exhibit pickers, the report editor's evidence lookup
  (ReportsTab FormEditor), RICO predicate-act evidence links (RicoTab).
- **\`shared/VersionViewer.tsx\`** — immutable version list + snapshot
  render. Used by: finalized report versions (ReportsTab "Versions" toggle
  over \`report_versions\`), the SOP history modal (SopsView).
- **\`shared/SignatureViewer.tsx\`** — signature trail render (supports
  superseded entries). Used by: legal version-bound signatures, report seal
  signatures incl. superseded seals from the reopen log (ReportsTab),
  tracker command co-signs (Trackers).
- **\`ui/DeadlineChip.tsx\` + \`lib/deadlines.ts\`** — the shared deadline
  engine (\`lib/justice.ts\`'s \`deadlineInfo\` now delegates to it). Used by:
  legal expiry/response deadlines, case-task due dates (TasksTab),
  joint-case access expiry (OverviewTab), case follow-ups (CaseDetail).
  **Reuse when**: any surface shows a due/expiry timestamp — same
  vocabulary everywhere.

## The UX-pass shared set (2026-08-25)
Extracted or introduced by the portal-wide UX pass — same rule: reuse, don't
re-inline.

- **\`ui/StatusBadge.tsx\` + \`lib/status.ts\`** — THE status chip. Every
  status vocabulary (case, stage, sign-off, legal review, warrant, field
  submission, priority, threat, confidence, provenance, BOLO risk, seized
  items, person review, account ownership, charges) renders through the
  central registry: consistent label + tint, a tooltip carrying the
  status's meaning and (for workflows) who acts next. **Reuse when**: any
  status renders as a chip — never hand-pick chip classes for a status
  again.
- **\`ui/AccessBadge.tsx\`** — one chip for the three access vocabularies
  (SIB visibility, legal classification, SOP classification) with
  who-can-access titles. **Reuse when**: a record's access level renders.
- **\`ui/SaveState.tsx\` + \`lib/userDrafts.ts\`** — the autosave layer:
  debounced DB-backed drafts (\`user_drafts\`) with a per-user local mirror
  and the Saving/Saved/Offline chip. Used by report forms, case
  notes/chat, person/gang creation, intel summaries. **Reuse when**: any
  long-form input should never lose work. (The legal wizard keeps its own
  stash flow deliberately.)
- **\`ui/RecordPeek.tsx\` + \`shared/RecordPeekButton.tsx\` +
  \`lib/entityPreview.ts\`** — the "is this the record I think it is?"
  preview card (lite RLS-scoped projection, status chips, linked counts,
  access-restricted stub for invisible rows). **Reuse when**: a linked
  record deserves a glance without navigation.
- **\`shared/LinkEditPopover.tsx\`** — the ONE editor for an existing
  relationship-link row (confidence / current-historical-disputed status /
  role / note) over the link tables' UPDATE policies; the server-side
  \`audit_detail\` triggers record old/new content. **Reuse when**: any link
  table gains an editable attribute — never delete-and-recreate.
- **\`shared/RecordSearchPicker.tsx\`** — bounded, RLS-scoped search picker
  for attaching registry records (upgraded by the entity-select pass —
  see below). **Reuse when**: any "link a record" flow.
- **\`shared/DuplicateMatches.tsx\`** — non-blocking duplicate hints under
  the name/plate field of the Person/Gang/Vehicle/Place create modals
  (plate hints compare \`normPlate\` equality, so punctuation variants
  match).
- **\`shared/PinButton.tsx\` + \`lib/pins.ts\`** — pin toggle (person,
  vehicle, gang, account, narcotics profiles + case headers).
- **\`shell/CreateHost.tsx\`** — the universal "+ Create" provider:
  \`useCreate().open(kind)\` opens the exact exported registry modal,
  lazy-loaded, permission-gated. **Reuse when**: any surface wants a
  create shortcut — never fork a second copy of a create form.

## The entity-select shared set (2026-08-25)
The smart search/select/link/autofill pass — one picker contract for
every "attach a record" flow. Same rule: reuse, don't re-inline.

- **\`shared/RecordSearchPicker.tsx\`** — THE bounded record combobox. The
  caller supplies the loader (so the picker can never widen access; \`''\`
  lists recent rows), and full combobox a11y comes from
  \`shared/useListboxNav\`. Everything beyond the base contract is opt-in
  and default-off: thumbnails (\`getThumb\` → \`ui/RecordThumb\`), per-row
  disable-with-reason (\`getDisabled\` — LOA/inactive/already-linked rows
  stay visible, badged and unselectable), quick previews (\`peekType\`), a
  create-new action row (\`onCreateNew\`), a free-text fallback
  (\`allowFreeText\` — never the default), \`minChars\`, multi-select chips.
  **Reuse when**: any "link a record" flow — and take the loader from
  \`lib/entitySearch\`, never a hand-rolled query. (\`siu/SiuRegistryPicker\`
  now runs this internally over the same \`siu_registry_search()\` RPC.)
- **\`lib/entitySearch.ts\`** — the per-kind suggestion-query registry
  (\`searchEntities(kind, q, opts)\` + typed arms such as
  \`searchPersonHits\`/\`searchMemberHits\`): the indexed \`search_persons\`
  two-step ranked RPC for persons, normalized-plate matching for
  vehicles, gang/place/account/case/operation/narcotic/legal-request
  arms, roster and penal-charge cache filters. Bounded (~20), RLS-scoped,
  merged tombstones filtered, transient failure ⇒ \`[]\`. Matching-only
  normalizers (\`normPlate\`/\`normPhone\`/\`normHandle\`) never alter display
  values. **Reuse when**: any picker needs a loader.
- **\`lib/autofill.ts\`** — pure save-choice engine: \`buildAutofill\`
  (master data fills only user-empty fields, provenance tracked) and
  \`diffForMasterUpdate\` (fill-the-master's-gaps only — never overwrites a
  non-empty value, never writes blanks). No I/O — pair it with an
  explicit \`uiConfirm\` and the audited \`update()\` path.
- **\`shared/LinkedPersonPanel.tsx\` + \`shared/personCompletion.ts\`** — the
  "linked to a registry profile" panel on the case link form: linked-state
  clarity (badge + Open profile) plus optional completion of blank
  profile fields with the explicit case-only-vs-update-profile choice.
- **\`shared/useListboxNav.ts\`** — the combobox/listbox keyboard kernel
  (\`aria-activedescendant\`, wrap-around arrows, disabled-row skipping,
  Escape containment). **Reuse when**: any suggestion list under an
  input.
- **\`ui/RecordThumb.tsx\`** — unified record avatar/thumbnail
  (safeUrl-guarded image, broken-image → initials fallback). Used by
  picker rows, \`RegistryCard\` and the gang roster.

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
| \`src/components/tools/\` | Investigative Tools workspace (\`/tools\`): directory, tab strip, redirect shim, lazy tool registry |
| \`src/components/shared/\` | Cross-feature record widgets (v1.14 extractions) |
| \`src/components/ui/\` | Generic widgets |
| \`src/lib/\` | ⚠ All shared logic |
| \`supabase/\` | Backend migrations, edge functions, backend docs |

## \`src/lib/\`

| File | One-liner |
|---|---|
| \`auth.tsx\` | ⚠ Sign-in state machine + \`useAuth()\` context + capability booleans |
| \`autofill.ts\` | Pure autofill/save-choice invariants — \`buildAutofill\` never replaces user input; \`diffForMasterUpdate\` fills only the master's gaps (no overwrites, no blanks); no I/O |
| \`database.types.ts\` | ⚠ Hand-maintained TS mirror of the live schema |
| \`db.ts\` | ⚠ THE data layer: list/insert/update/remove/rpc/softDeleteRecord/restoreRecord/withRetry |
| \`deleteRecord.ts\` | the one delete helper — confirm → reason (when required) → \`soft_delete\` per row → the "deleted · In Trash" Undo toast (\`restore_record\`) |
| \`trash.ts\` | the Trash's client model: \`fetchTrash\` (\`trash_list\`), groups, labels, deep links, \`restoreFromTrash\`, the badge store |
| \`docx.ts\` | Dependency-free OOXML writer (byte-fragile ZIP) |
| \`deadlines.ts\` | Shared deadline engine (v1.14) — feeds \`ui/DeadlineChip\`; \`justice.ts\` delegates to it |
| \`caseHealth.ts\` | Pure, clock-injected advisory health flags (hygiene + due/returned signals) — never fetches, skips flags whose inputs weren't passed; renders via \`cases/CaseHealthRow\` + the CasesView attention marker/"Needs attention" filter |
| \`drafts.ts\` | localStorage draft primitive (\`cid-draft:\` keys) — now mostly \`userDrafts\`' local mirror; the legal wizard's stash keeps the legacy shared keys |
| \`userDrafts.ts\` | DB-backed never-lose-work drafts (\`user_drafts\`, owner-only RLS, cross-device): debounced upsert, per-user local mirror, 60KB guard, offline degradation; feeds \`ui/SaveState\` |
| \`entityPreview.ts\` | Lite RLS-scoped record projections + linked-record counts for \`ui/RecordPeek\` (incl. case/operation/member kinds) |
| \`entitySearch.ts\` | Shared entity-search registry — bounded per-kind picker loaders (\`searchEntities\` + typed arms), matching-only normalizers (\`normPlate\`/\`normPhone\`/\`normHandle\`), merged tombstones filtered |
| \`fivemanage.ts\` | Media upload (multipart → hosted URL) |
| \`format.ts\` | timeAgo/todayISO/fmtUSD/slug/downloadBlob/copyText |
| \`forms.ts\` | 8 report schemas + warrant helpers + finalize-gap check |
| \`markdown.tsx\` | Safe mini-Markdown → React (no innerHTML, ever) |
| \`nav.ts\` | ⚠ PAGE_META / categories / labels — the nav contract |
| \`notify.ts\` / \`notifText.ts\` | Notification write (RPC, unforgeable) / render vocabulary |
| \`notifications.ts\` | Shared notification actions — mark-read, mark-all (one conditional update), accurate unread count, mute prefs (\`user_prefs\` key \`notif_muted\`; only \`OPTIONAL_NOTIF_CATEGORIES\` are mutable) |
| \`operations.ts\` | Operations zustand cache + status colors |
| \`packet.ts\` / \`pdf.tsx\` | Case-packet gathering / court-styled PDF renderer (dynamic import) |
| \`penal.ts\` | Static penal code (162 charges) + calculators |
| \`pins.ts\` | DB-backed pinned records (\`user_pins\`, owner-only RLS, cross-device, ids only, soft cap 24) — distinct from the Follow watchlist |
| \`profiles.ts\` | Roster cache + \`officerName()\` |
| \`recents.ts\` | Device-local recently-opened trail (Store blob, ids only, pushed on deliberate opens) |
| \`savedViews.ts\` | Per-user saved views over \`user_prefs\` (\`views:<section>\` rows, opaque caller-shaped config, one default per section; one-time migration of the legacy \`caseViews\` Store key) |
| \`realtime.ts\` | ⚠ One channel per table → version counters (\`useTableVersion\`) |
| \`roles.ts\` | Role/bureau vocabulary + seniority + command predicates |
| \`safeUrl.ts\` | ⚠ XSS scheme allow-list for DB-sourced URLs (tested) |
| \`schemas.ts\` | Zod tolerant parsers for structured JSON payloads (v1.14) — legal form_data, packet manifests, notification payloads, report signatures/reopen logs, security overview |
| \`search.ts\` | \`search_all\` RPC wrapper (now incl. bolo/task arms) + client-side charge/member/intel-tip hits, kind metadata (\`SEARCH_KINDS\`) + recent searches |
| \`signoff.ts\` | Read-only sign-off vocabulary/tints/"whose court" hint |
| \`status.ts\` | ⚠ Central status registry — label/tint/meaning/who-acts-next for every status vocabulary (composes \`tint.ts\` + domain vocabularies; disambiguates warrant "Return filed" from legal "Returned for revision"); render via \`ui/StatusBadge\` |
| \`store.ts\` | The shared localStorage blob (legacy-compatible keys) |
| \`supabase.ts\` | ⚠ Lazy client singleton + \`isConfigured\` |
| \`toast.ts\` | Toast store + \`humanizeError\` |
| \`toolsModel.ts\` | ⚠ Investigative Tools model (data only) — TOOL_TABS/groups, record deep-link params, RLS title sources |
| \`watchlist.ts\` | Follow-store + seen stamps |

## \`src/app/\` & \`src/components/shell|ui/\`

| File | One-liner |
|---|---|
| \`app/layout.tsx\` | Root HTML, fonts, pre-hydration theme applier (the one sanctioned innerHTML) |
| \`app/page.tsx\` | ⚠ \`/\` redirect shim + OAuth-callback wait |
| \`app/(app)/layout.tsx\` | AuthProvider → Gate/AppShell boundary |
| \`app/(app)/[tab]/page.tsx\` | ⚠ The per-tab switch (intelligence tool slugs → \`ToolTabRedirect\` → \`/tools\`) |
| \`app/globals.css\` | ⚠ Theme tokens, accent remap, collapse contract, editor styles |
| \`app/error/global-error/not-found.tsx\` | Crash and 404 screens |
| \`shell/AppShell.tsx\` | Chrome composition + tab persistence |
| \`shell/Header.tsx\` | Title bar, \`/\` & ⌘K shortcuts, LOA, sign-out |
| \`shell/Sidebar.tsx\` | ⚠ Categories, badges, body-class collapse |
| \`shell/BottomNav.tsx\` / \`Subtabs.tsx\` | Mobile bar / in-category tab strip |
| \`shell/SearchPalette.tsx\` | ⚠ ⌘K search + permission-gated go-to/create commands (full-screen sheet below \`lg\`) |
| \`shell/CreateHost.tsx\` | Universal "+ Create" context provider — lazy-loads the exported registry modals; \`useCreate().open(kind)\` |
| \`shell/NotificationsBell.tsx\` | Live bell — grouped clusters, accurate unread count, mark-all, mute settings (via \`lib/notifications\`) |
| \`shell/useNav.ts\` / \`useNavBadges.ts\` | Routing helpers / ⚠ badge logic mirroring server rules |
| \`shell/ConnBanner\` / \`AppearanceModal\` / \`MyProfileModal\` / \`icons\` | Offline pill / accent+density / self-profile / SVG icons |
| \`ui/Modal.tsx\` | ⚠ Focus trap, dirty guard, scroll-lock, ref-routed handlers |
| \`ui/dialog.tsx\` | uiConfirm/uiPrompt + host |
| \`ui/DataTable.tsx\` | Sort/filter/CSV table (+ injection-guarded \`csvCell\`) |
| \`ui/RichEditor.tsx\` | Tiptap markdown editor |
| \`ui/Toaster.tsx\` | Toast renderer |
| \`ui/WorkflowTimeline.tsx\` / \`ui/DeadlineChip.tsx\` | v1.14 shared history render / deadline chip (see [Ch. 6](06-components.md)) |
| \`ui/StatusBadge.tsx\` / \`ui/AccessBadge.tsx\` | Registry-backed status chip (tooltip: meaning + who acts next) / one chip for the three access vocabularies (SIB visibility, legal classification, SOP classification) |
| \`ui/RecordPeek.tsx\` / \`ui/SaveState.tsx\` / \`ui/RecordThumb.tsx\` | Lazy record-preview card (data from \`lib/entityPreview\`) / autosave-state chip (fed by \`lib/userDrafts\`) / unified record avatar (safeUrl image → initials fallback) |
| \`shared/RelatedRecordPicker.tsx\` / \`VersionViewer.tsx\` / \`SignatureViewer.tsx\` | v1.14 cross-feature record picker / version list / signature trail |
| \`shared/LinkEditPopover.tsx\` / \`RecordSearchPicker.tsx\` / \`DuplicateMatches.tsx\` / \`PinButton.tsx\` / \`RecordPeekButton.tsx\` | Relationship-link editor (confidence/status/note over the link tables' UPDATE policies) / bounded registry search combobox (loaders from \`lib/entitySearch\`; opt-in thumbs, disable-with-reason, peeks, create-new, free-text, multi-select) / non-blocking duplicate hints on create modals / pin toggle over \`lib/pins\` / peek trigger |
| \`shared/LinkedPersonPanel.tsx\` / \`personCompletion.ts\` / \`useListboxNav.ts\` | Case link form "Registry profile" panel with the case-only vs update-profile completion choice / its pure field-split + provenance-line logic / combobox keyboard kernel (aria-activedescendant, disabled-row skipping) |

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
\`guides/\`→the Guide Library (\`GuideLibraryView\`, \`GuidePage\`, \`docs/*\`) · \`heatmap/\`⚠\`HeatmapView\` ·
\`inbox/\`⚠\`InboxView\` · \`indicators/IndicatorsView\` (matchKey) ·
\`media/MediaView\` · \`modus/ModusView\` (crossref) ·
\`narcotics/NarcoticsView\` · \`network/NetworkView\` ·
\`operations/OperationsView\` · \`penal/PenalView\` ·
\`personnel/\`: PersonnelView, AdminPanel, ⚠AssignModal, Commendations ·
\`persons/\`: PersonsView, PersonModal, ⚠IntelProfile, dossier ·
\`places/PlacesView\` · \`records/RecordsView\` (zero-rows check) ·
\`rico/RicoView\` (imports CaseDetail's RicoTab) · \`shifts/ShiftsView\` ·
\`sops/SopsView\` (version snapshots) ·
\`tools/\`: ⚠\`ToolsView\` (the Investigative Tools workspace), \`ToolTabBar\`,
\`ToolDirectory\`, \`ToolTabRedirect\`, \`toolRegistry\`, \`useToolCounts\` ·
\`vehicles/VehiclesView\` (scanner) ·
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
scoped (\`can_access_case\`); archival command-only, permanent deletion
Owner-only.

1. **Create** — \`CasesView\` "+ New Case" (or ⌘K "new case", or the ticket
   wizard) → \`CaseModal\`: template chips prefill fields + a task
   checklist; \`insert('cases')\` with \`case_number = BUREAU-digits\`;
   checklist rows → \`insert('case_tasks')\`.
2. **Work it** — \`CaseDetail\`'s 12 tabs (Overview, Graph, Evidence & Media,
   Intel & Notes, Charges, RICO — conditional, shown when the case has
   tracker data or the viewer enables tracking, Reports, Tasks, Legal,
   Sign-off, Chat, Timeline) each fetch and write their own case-scoped
   tables. Visited tabs stay mounted (\`display:none\` keep-alive) with
   per-tab scroll restore, section pills carry counts + attention markers,
   and the \`caseSeen\` recap stamp is written on case *exit*, not on tab
   switches. An advisory Health row (\`lib/caseHealth\` — pure,
   clock-injected, never fetches; flags skip when their inputs weren't
   passed) renders clickable hygiene chips under the header; the same
   list-safe flags power the command-only "Needs attention" filter.
   Custody transfers append to the immutable \`custody_chain\`.
3. **Move it** — drag on the board → \`update('cases', {status})\`; triggers
   stamp \`closed_at\`/\`updated_at\`.
4. **Stale escalation (automatic)** — once per session, \`CasesView\` finds
   open/active cases quiet ≥14 days, claims them with a compare-and-swap
   (\`updateWhere … last_stale_notified_at is null\`) and notifies
   lead/bureau-leads/deputy. The CAS prevents two open tabs double-firing.
5. **Sign-off** — \`rpc('signoff_submit')\` → SQL picks the stage + a
   non-LOA assignee (never the submitter/lead) → the routed assignee
   decides via \`rpc('signoff_decide')\` (a Director may override; the
   submitter can never decide their own case), owner
   \`rpc('signoff_owner_action')\`. History rows + notifications are written
   inside the RPCs. Direct column writes are trigger-blocked.
6. **Export** — the packet button gathers everything
   (\`lib/packet.gatherCasePacket\`, partial-tolerant) and renders PDF
   (dynamic-imported \`lib/pdf\`), DOCX (\`lib/docx\`), or Markdown.
7. **Archive / delete** — command archives (\`rpc('case_archive')\`:
   restorable, audited; archived cases leave working views and live under
   the command-only Archived filter). Only the Owner permanently deletes,
   via a catalog-derived preview + reasoned confirm
   (\`case_delete_preview\` → \`case_permanent_delete\`); cases with legal
   requests refuse deletion. There is no undo-based case delete anymore.

**Data flow**: user action → \`db.ts\` helper → PostgREST → RLS check →
row change → realtime event → version bump → every subscribed view
refetches → UI updates (including other users' browsers).

## 4.2 Intelligence registries

Persons, gangs (ranks/members/turf), vehicles, places, narcotics,
ballistics, media vault, records, BOLO board — all one uniform pattern
(fetch + version counter, \`?q=\` seeded filter, card grid, modal CRUD,
canEdit/canDelete gates, \`deleteRecord\` → \`soft_delete\`). Shared RLS: any active member
reads/writes, command deletes. The \`IntelProfile\` slide-over
(persons/gangs) rolls up everything linked to a subject and exports
dossiers. All of these open as tabs inside the **Investigative Tools**
workspace (\`/workspace?tool=…\`, \`src/components/tools/\`); the old \`/tools\` and per-tool routes
redirect there with their params intact ([Ch. 5](05-pages.md)).

**Entity search & linking (2026-08-25)**: every link/attach flow runs the
shared entity-search registry (\`lib/entitySearch\` — bounded per-kind
queries behind one \`searchEntities()\` door: the indexed \`search_persons\`
two-step ranked RPC for persons, normalized-plate matching for vehicles
(\`normPlate\`), roster/penal client caches for the member/charge arms;
RLS-scoped, merged tombstones filtered, transient failure ⇒ no
suggestions) through \`shared/RecordSearchPicker\`. Case person-linking
(IntelTab) adds \`shared/LinkedPersonPanel\`: linked-state clarity
("Registry profile" badge + Open profile) and optional completion of
blank profile fields with an explicit save choice — provenance-labelled
"(case record)" link-note lines (case only, \`shared/personCompletion\`) or
a confirmed, audited, gaps-only \`persons\` update
(\`lib/autofill.diffForMasterUpdate\` — never overwrites a non-empty value,
never writes blanks). Report person fields commit name + canonical
\`person_id\` atomically (ReportsTab \`PersonField\`; free text stays
possible but renders "Not linked", and read views resolve only the
referenced ids). The create-new escape hatch chains \`CreateHost\` →
\`PersonModal onCreated\` to auto-link the fresh row to the case. The
whole-registry preloads all this replaced (the reports persons datalist,
accounts/vehicles owner selects, the surveillance 200-row pools,
CreateHost option lists) are gone.

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
RPC (pg_trgm fuzzy, RLS-scoped, SECURITY INVOKER) + client-side hits
(static penal charges, cached-roster members — never email — and intel
tips via \`field_submission_search\`). Kinds now also include \`bolo\` and
\`task\` (server arms, \`20260826010000\`; a task hit carries its task id in
\`term\` and deep-links the case Tasks tab). Results render grouped with
per-kind tags (\`SEARCH_KINDS\`); record hits open as Investigative Tools
record tabs and push the recents trail. A sequence guard drops
out-of-order responses. Enter deep-links (\`?case=\`, \`?q=\`,
and since v1.14 \`/legal?request=\` for legal-request hits). v1.14 added a
\`legal\` kind to \`search_all\`: header fields only, and because the function
is SECURITY INVOKER every hit passes the \`legal_requests\` SELECT policy —
sealed requests never surface. Commands are permission-gated: go-to
entries exist only for tabs the viewer may open (owner/audit/devdocs/
command-center/SIB are not disclosed to everyone), and the New-record set
runs through the shared \`CreateHost\` provider (\`useCreate()\`), which
lazy-loads the exact modals the registry views export. Below \`lg\` the
palette is a full-screen sheet.

## 4.5 Command tools

Division Overview (a Command Center section since the 2026-09-10 cleanup; \`/command\` redirects there — the member-facing division picture: a
case-vitals KPI strip whose tiles navigate to the owning list, crime
analytics, the dual-co-sign GPS trackers — self-co-sign blocked in UI
*and* by trigger — and the raid-compensation calculator; the
needs-attention widget, command filter bar/drill, bureau scorecards and
caseload bars moved to the Command Center, with a pointer banner for
command staff — which also carries the Cases & Assignments and
Intelligence Oversight queues, the permissions matrix from
\`src/lib/permissionsMatrix.ts\`, and a bureau-vs-division scope badge
from \`useCapabilities()\`), division analytics (SVG charts, Monday-week
buckets),
announcements (audience-targeted: everyone/\`@everyone\` for deputy+ only,
command, own/specific department, or just the mentioned members — the
\`publish_announcement()\` RPC resolves recipients server-side with one
notification each, a recipient-count preview and confirm in the composer,
and edits never re-notify unless explicitly requested), heatmap
(weighted layers, pan/zoom SVG map), roster (membership requests: new
sign-ins request ONE permanent department — Major Crimes or Street Crimes (\`major_crimes\`/\`street_crimes\`), never JTF or SIB — plus
any normal CID role (v1.16: detective … director; requesting grants
nothing) from the inactive-account screen; the Approval Queue reviews them
via \`review_membership_request()\` — approve / approve-with-changes (reason
required) / request-correction / reject — under the unified authority
matrix ([Ch. 9](09-auth.md)), activating the profile only on approval; the
legacy one-click \`assign_member\` approve remains for requestless profiles
(activation-only). Promotions/demotions run through \`change_member_role\`
and department moves through the single-step \`transfer_requests\` move —
an authorized initiator (a Bureau Lead when one side is their own bureau,
or Deputy Director+) picks a destination and reason and the move applies
immediately, JTF included — both audited with reasons). Joint cases:
\`convert_case_to_joint()\` tags a case JTF while preserving its
originating bureau and grants selected members temporary case-scoped
access (joint roles, optional expiry, removable, endable) — access model
in Ch. 8.

## 4.6 Personal tools

My Dashboard (\`/inbox\`, the default landing — a prioritized
needs-attention panel over the Action Center's top items, plus my-cases,
"Jump back in", open Investigative Tools tabs, drafts, watched items and
bounded recent activity; every self-fetch a slim limited projection,
with a capability-gated dashboard switcher chip row from
\`useCapabilities()\`), the Action Center
(\`useActionQueue\` — one shared queue store of slim fetches → the pure \`buildActionItems\` model;
wave-3 lanes add Unassigned intel, Expiring BOLOs and Drafts — the drafts
lane describes \`user_drafts\` KEYS, never payloads), watchlist (follow +
"updated" chips via localStorage seen-stamps), pins & recents (the My
Dashboard "Jump back in" strip — DB pins + device recents, both ids-only,
titles RLS-resolved at render), saved views on the Cases/Persons/Legal/
BOLO lists (\`lib/savedViews\` over \`user_prefs\`; re-applying a view only
re-applies client filter state — RLS still decides what it matches),
autosaved drafts (\`lib/userDrafts\` + the \`ui/SaveState\` chip on reports,
case notes, chat, person/gang creation, intel summaries), calendar
(follow-ups, task due dates, report weeks), shift reports (one per week
enforced by unique key, auto-rollup), notifications bell (grouped
clusters, exact unread count, mark-all, optional-stream mutes; the server
suppresses identical unread duplicates inside an hour).

## 4.7 Reference & exports

Penal code (static data + calculators), SOPs & library (version snapshot
BEFORE every overwrite; command-write-only folders), the visual user
guide, court packet/dossier exports, audit-log CSV export
(formula-injection-guarded).

## 4.8 Portal Improvements (Phases 1–8, release 1.18.0)

- **Permission module** — \`permission_catalog\` → \`my_permissions()\` /
  \`can_record()\` on the server, \`usePermissions()\` + the mirrors in
  \`src/lib/permissions/\` on the client ([Ch. 9](09-auth.md)).
- **Unified workspace** (\`/workspace\`) — cases, records and tools in one
  keep-alive tab strip; authored \`case_notes\`, related-case links, the
  activity feed (\`case_audit_feed\`); archived cases read-only at RLS
  (\`private.case_writable\`).
- **Entity layer** — normalized keys, \`entity_suggest\` / \`entity_duplicates\`
  / \`entity_crossref\`, the reversible merge ledger, observations and update
  suggestions, the SIB reconcile queue.
- **Legal workflow** — judge-only route, charges, threaded comments,
  revision checklists, partial approval, amend / observers, the hourly
  \`legal-sweep\`.
- **Report builder** — DB templates with admin, the review flow
  (submit → return / approve → sealed), entities, export receipts, task
  waivers for the closure gate.
- **Intel triage** — rejected status, reviewer-private notes vs officer
  messages, the validation mark, intel groups, extended claim links,
  convert-to-record, the SIB cross-link.
- **Action Center** (\`/inbox\`; \`/action\` redirects) — every queue kind with per-viewer state
  (seen / snooze / dismiss), escalation rules and ledger, reassignment, saved
  views and presets, one queue store shared with My Dashboard and the
  Command Center, minimal notification payloads hydrated through
  \`notification_resolve\`.
- **Versions, Trash, permanent deletion, the scheduler** —
  [Ch. 22](22-versions-trash.md): soft delete on 27 kinds with the
  "<Label> deleted · In Trash" Undo toast, \`/trash\` (\`trash_list\` — the
  rows the caller could restore), \`RecordHistory\` (compare / restore with a
  reason), the Owner's armed \`permanent_delete_record_*\`, seven pg_cron jobs.
- **Phone-first case route** (\`/m/cases/[id]\`) — cards, a bottom section
  switcher, quick actions that make the desktop's writes, narrative-only
  report editing; the workspace redirects a narrow viewport there.`,
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
| \`/\` | \`app/page.tsx\` | Redirect shim: legacy \`#deep-links\`, else \`/inbox\` (My Dashboard — the default landing). Also the OAuth landing spot — it **waits** for the auth event before redirecting. |
| \`/<tab>\` | \`app/(app)/[tab]/page.tsx\` | One of the screens in \`PAGE_META\`. Invalid slugs → \`/inbox\`; legacy \`reports\` → \`/cases\`; the 14 intelligence tool slugs render \`ToolTabRedirect\`, which forwards into \`/tools\` (below). |
| \`/m/cases/[id]\` | \`app/(app)/m/cases/[id]/page.tsx\` | The **phone-first case screen** (\`mobile/MobileCaseView\`) — the one route outside the \`[tab]\` pattern (a Next dynamic segment; a client component reads \`useParams()\`). \`?s=<section>\` picks the section (overview, tasks, notes, people, vehicles, gangs, locations, media, reports, activity; a desktop-only section shows an "Open on desktop" card). The workspace and \`/cases?case=\` redirect a narrow viewport here unless the tab chose the desktop (\`sessionStorage['cid:desktop-on-mobile']\`). Renders in a slim shell (case number + "Open on desktop"). |
| anything else | \`app/not-found.tsx\` | Styled 404. |

\`(app)/layout.tsx\` wraps every tab in \`AuthProvider\` → \`Gate\` (sign-in
screens when not authenticated) → \`AppShell\` (chrome). All tab routes are
**statically pre-rendered** — safe because pages embed no data; everything
fetches after mount behind RLS.

**Deep-link parameters**: \`?case=<id>\` (open case detail), \`?q=\` (seed a
registry filter), \`?new=1\` (open New Case), \`?op=\` (operation),
\`?focus=g:<id>|p:<id>\` (network), \`?tab=\` (case detail tab),
\`?tool=<id>&record=<id>\` (Investigative Tools — active tab / record tab).

**Shared states**: every screen renders "Loading…" while fetching,
"Could not load: reason" on failure (reads throw), an ALL-CAPS themed
empty state, and a sign-in notice when unauthenticated.

## The screens

One row per leaf tab in \`PAGE_META\` (\`src/lib/nav.ts\` — the routing truth).

| Slug | Screen (component) | Data highlights | Extra permissions |
|---|---|---|---|
| \`command\` | Division Overview (\`CommandView\` — lean member-facing division picture: navigating case-vitals tiles, analytics, activity feed, trackers, raid comp; the needs-attention widget, filter bar/drill, scorecards and caseload bars moved to the Command Center, pointer banner for command staff) | cases, evidence, persons, gangs, trackers | — |
| \`analytics\` | Division Analytics | cases, evidence, persons (charts) | — |
| \`announce\` | Announcements | announcements | posting = command |
| \`heatmap\` | Crime Heatmap | cases, turf, places, raids | — |
| \`personnel\` | Roster & Commendations | profiles (+ admin RPCs), commendations | admin panel = command |
| \`cases\` | Case board + detail (keep-alive case sections; saved views via \`lib/savedViews\`; DataTable row-selection bulk status/lead/archive — chunked, preview-confirmed, no bulk delete) | the whole case constellation | bureau-scoped; bulk lead assign command-only |
| \`operations\` | Task Forces | operations, cases | — |
| \`case-files\` | Attachments | case_files + FiveManage | delete = command |
| \`rico\` | RICO tracker | rico_cases, predicate_acts | — |
| \`legal\` | Legal Requests (\`LegalView\`) | legal_requests + versions/exhibits/actions/participants | creator + participants; all workflow writes via definer RPCs |
| \`justice\` | Justice Portal (\`JusticePortalView\`) — **RETIRED 2026-07-22**: route/tab removed, memberships deactivated; legal approval is now Bureau Lead+ in the CID \`legal\` surface (see [DOJ-INTEGRATION.md](../DOJ-INTEGRATION.md) Phase-1 banner) | legal review queues, judge docket, coverage, applications | justice roles + Owner (justice-only members get it as their whole app) |
| \`tools\` | Investigative Tools workspace (\`tools/ToolsView\`) — grouped directory + keep-alive tab strip over the 14 tool views below; open tabs persist per user (ids only) and restore RLS-verified | opens the tools below as tabs; Persons & Vehicles records as own tabs | — |
| \`persons\` ¹ | Persons → IntelProfile | persons, gang_members, vehicles | — |
| \`bolo\` ¹ | BOLO Board | persons(bolo), warrant reports | — |
| \`gangs\` ¹ | Gangs | gangs, ranks, members, turf | — |
| \`places\` ¹ | Places | places, process steps | — |
| \`vehicles\` ¹ | Vehicle Registry | vehicles + cross-ref scan | — |
| \`accounts\` ¹ | Account Registry | accounts, handle history | — |
| \`indicators\` ¹ | Indicators | indicators + deconfliction | — |
| \`field-review\` ¹ | Intelligence (field review) | field_submissions + claims | — |
| \`network\` ¹ | Network graph | gangs, persons, members | — |
| \`narcotics\` ¹ | Narcotics | narcotics + precursors + hotspots | — |
| \`ballistics\` ¹ | Ballistics | benches + footprints | — |
| \`modus\` ¹ | M.O. Detector | mo_profiles + \`mo_crossref\` RPC | — |
| \`media\` ¹ | Media Vault | media + FiveManage | — |
| \`records\` ¹ | Records | cid_records | edit = creator/command |
| \`penal\` | Penal Code | static (no DB) | — |
| \`sops\` | SOPs & Library | documents + versions | writes = command |
| \`guide\` | *(retired)* | redirects to \`/guides/user-guide\` — the Portal User Guide is a guide in the library | — |
| \`devdocs\` | Developer Handbook (\`DevDocsView\`) | generated handbook content | **owner-only** |
| \`action\` | Action Center (\`ActionCenterView\`) | prioritized pending decisions across cases, command, personnel + Unassigned intel / Expiring BOLOs / Drafts lanes and an SIB items branch (\`lib/actionItems\`), type + bureau filters | self-scoped |
| \`inbox\` | My Dashboard (\`InboxView\`) — the **default landing**: needs-attention (Action Center top slice), my cases, "Jump back in" (\`command/JumpBack.tsx\`), open tool tabs, drafts, watched items, bounded recent activity; capability-gated dashboard switcher chip row (labels from \`src/lib/nav.ts\`; the Phase-1B \`DashSwitcher\` component was retired in Phase 7) | slim limited projections over cases/reports/messages/legal/drafts + user_pins/watchlist | self-scoped |
| \`calendar\` | Calendar | cases, tasks, shift weeks | — |
| \`shifts\` | Shift Reports | shift_reports | edit own |
| \`audit\` | Audit Log | audit_log (DataTable + CSV) | **owner-only** |
| \`trash\` | Trash (\`trash/TrashView\`) — the fourth Oversight tab next to Audit: the deleted records the viewer could restore, grouped Cases / Case material / Registry / Links behind filter chips, search on the label, **Restore** (confirm; an optional reason for the parent kinds), the Owner's inline **Permanently delete…** (\`shared/RecordPermanentDelete\`); refreshes on focus / after an action / every 60 s | \`trash_list(kind?, limit)\` / \`trash_count()\` (the Sidebar badge) → \`restore_record\`, \`permanent_delete_record_*\` | every active member sees their own restorable rows; command their cases; the Owner everything |
| \`workspace\` | Unified workspace (\`workspace/WorkspaceView\`) — cases, records and tools side by side in one keep-alive tab strip (ids-only persistence, titles re-resolved through RLS; eight tabs max); \`/cases?case=&tab=\` and \`/tools?tool=&record=\` redirect in; a case tab is \`CaseDetail\` embedded with \`CaseSectionSwitcher\` | the whole case constellation, \`case_notes\`, \`case_links\`, \`case_audit_feed\`, \`record_history\` | as the underlying rows; archived cases read-only at RLS (\`case_writable\`) |
| \`feedback\` | Feedback (sidebar leaf) | feedback | triage = owner flag (\`profiles.is_owner\`) |
| \`profile\` | My Profile (\`ProfileView\`) | own profile, appearance, notification settings | self |
| \`command-center\` | Command Center (\`CommandCenterView\`, \`?s=\` sections) | command dashboard overview, Cases & Assignments and Intelligence Oversight queues, personnel admin, approvals, promotions, transfers, duty status, permissions matrix (\`src/lib/permissionsMatrix.ts\`), bureau-vs-division scope badge | command + Owner |
| \`owner\` | Owner Console (\`OwnerView\`, \`?s=\` sections grouped Overview / Operations / Safety / Reference; legacy \`?s=\` values redirect) | owner dashboard (warnings, pending queue, recent admin changes), portal management (SIB release gate, runbook), roles & access (justice grants, test-fixture flag), feedback triage, permanent deletion + ledger, security & audit, system health, handbook reference | **owner-only** |

¹ **Investigative Tools slugs.** These 14 routes stay registered (deep-link
contracts) but no longer render their view directly: the \`[tab]\` page returns
\`ToolTabRedirect\`, which \`router.replace\`s into
\`/tools?tool=<slug>\` — translating the record param for tools with workspace
record tabs (\`RECORD_TAB_TOOLS\` in \`src/lib/toolsModel.ts\`: currently
persons → \`?person=\` and vehicles → \`?vehicle=\` become \`&record=\`) and
carrying every other query param (\`?q=\`, \`?gang=\`, \`?focus=\` …) through
untouched. The views themselves are code-split in
\`src/components/tools/toolRegistry.tsx\` and render inside the workspace,
unchanged and still RLS-scoped.`,
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
| \`search_all(q)\` | search string | ranked hits, capped per kind (v1.14 adds \`legal\` — header fields only, never narratives; INVOKER + RLS keep sealed requests undiscoverable; \`20260826010000\` appends \`bolo\` and \`task\` arms — a task hit rides its task id in \`term\`, its case id in the row id) | SearchPalette | one round-trip fuzzy search, RLS-scoped |
| \`signoff_submit(p_case)\` | case id | updated case | CaseDetail | atomically route + stamp + history + notify; columns are trigger-locked |
| \`signoff_decide(p_case, p_decision, p_note)\` | case id, approve/deny/changes, note | updated case | CaseDetail | reviewer decision, validated against the current assignee |
| \`signoff_owner_action(p_case, p_action)\` | case id, complete/escalate/… | updated case | CaseDetail | owner-side chain actions |
| \`signoff_command_override(p_case, p_action, p_reason)\` | case id, complete/escalate, reason | updated case | SignoffTab | Deputy Director/Director/Owner act in the owner's place, only from the approved-by-deputy stop point; the reason is mandatory and history rows are stamped \`source='command_override'\` |
| \`case_archive(p_case, p_note?)\` / \`case_restore(p_case)\` | case id | updated case | CaseDetail/CasesView | command-only archive/restore — archiving hides the case from working views, destroys nothing, is audited, and is restorable at any time; the archive columns are trigger-locked |
| \`case_delete_preview(p_case)\` | case id | destruction manifest | CaseDetail (archived cases) | Owner-only — enumerates every table that references the case, with live row counts, before a permanent delete |
| \`case_permanent_delete(p_case, p_reason)\` | case id + reason | void | CaseDetail (archived cases) | Owner-only, reason required; refuses cases with legal requests; records the destroyed-row counts in the audit log before deleting |
| \`report_finalize(p_report, p_badge)\` | report id, badge | report row | CaseDetail Reports | the ONLY way to set \`finalized\`; stamps signer; since v1.14 also snapshots the sealed fields + signature into \`report_versions\` |
| \`assign_member(target, set_active)\` | profile id + flag | void | AssignModal/AdminPanel/ApprovalQueue | activation/deactivation ONLY since v1.16 (bureau-lead scoped; blocked for removed/login-denied members). Role changes and department moves have dedicated audited RPCs below |
| \`change_member_role(p_target, p_new_role, p_reason)\` | profile id + role + reason | profile row | AssignModal (Change role) | promotion/demotion within the member's department; the unified authority matrix (\`private.can_assign_cid_role\`) requires authority over BOTH old and new role (demoting a Director takes the Owner); reason recorded in \`role_events\` + \`ROLE_CHANGED\` audit + officer notified |
| \`request_transfer(p_target, p_to_bureau, p_reason, p_to_role?)\` | member + destination + reason | transfer row | AssignModal (Transfer department) | applies the transfer immediately (single step); a Bureau Lead may initiate only for rank-and-file touching their own bureau; DD+/Owner anywhere; moves between any two departments (JTF included); recorded in role_events + audit |
| \`approve_transfer_source\` / \`approve_transfer_target(p_id, p_note?)\` | transfer id | transfer row | PromotionsTransfers | **LEGACY** — kept only to settle transfer rows that were still open when transfers went single-step (20260807040000); \`request_transfer\` now applies the move on initiation and nothing creates pending rows anymore |
| \`complete_transfer(p_id)\` | transfer id | transfer row | PromotionsTransfers | **LEGACY** (same reason) — DD/Director/Owner settles a pre-existing open transfer directly |
| \`reject_transfer(p_id, p_note?)\` / \`cancel_transfer(p_id)\` | transfer id | transfer row | PromotionsTransfers | **LEGACY** (same reason) — either side's Lead or DD+ rejects a pre-existing open row; the requester or DD+ cancels it |
| \`admin_member_emails()\` | — | roster emails | PersonnelView | command-only bypass of the email column grant |
| \`admin_remove_member(p_target, p_reason?)\` / \`admin_restore_member(p_target)\` | profile id (+ optional reason) | void | AdminPanel | soft remove/restore (\`removed_at\`) under the unified authority matrix: Bureau Leads remove own-bureau detectives/senior detectives; Deputy Directors anyone below deputy; Directors anyone except owner accounts; the Owner anyone; system accounts refused; self-removal and removing the last active director blocked. Restore is Director/Owner-only and returns the member INACTIVE (they re-enter through review) |
| \`create_notification(user, type, payload)\` | recipient + payload | void | \`lib/notify.ts\` | insert for ANOTHER user with the actor stamped server-side (no forgery); since \`20260826010000\` an identical still-unread notification created within the last hour is silently dropped (dedupe guard) |
| \`mo_crossref(terms[])\` | term list | existence-only case matches | ModusView | controlled cross-bureau M.O. matching |
| \`report_reopen(p_report)\` | report id | report row | CaseDetail Reports | bureau-scoped seal break; prior signature kept in \`fields._reopen_log\` |
| \`warrant_set_status(p_report, p_status)\` | report id + status | report row | CaseDetail Reports | validated warrant lifecycle; only path on sealed warrants |
| \`membership_request_submit\` / \`_withdraw(p_request)\` | request id | request row | Gate (inactive screen) | applicant-side transitions; submit notifies command |
| \`review_membership_request(p_request, p_decision, …)\` | decision + final dept/role + notes | request row | ApprovalQueue | matrix-enforced decision (Det/Sr Det ← Bureau Lead of that bureau+; Bureau Lead ← DD+; DD ← Director+; Director ← Owner); approving with changes REQUIRES an applicant-visible reason; activates profile ONLY on approval; role_events (+reason/source/source_id) + history + audit atomically |
| \`admin_membership_requests()\` | — | all request rows | ApprovalQueue | command-only bypass of the internal-note column grant |
| \`deny_member_login(p_target, p_reason)\` / \`restore_member_login(p_target)\` | profile id + reason | profile row | AssignModal | app-level login block (Command/Owner, bureau-lead scoped); denied users hit an "Access denied" gate and can't file a request; \`login_denied*\` frozen by a non-definer trigger |
| \`convert_case_to_joint\` / \`joint_case_add_members(p_case, p_members)\` | case + member list | summary | CaseDetail/Overview | joint rows are RPC-only; bureau never flips to JTF |
| \`joint_case_remove_member(p_case, p_officer, p_reason)\` | case + member | void | Overview | immediate revoke, history preserved |
| \`joint_case_end(p_case, p_note)\` | case id | void | CaseDetail | closes all temporary joint access |
| \`publish_announcement(title, body, audience, …)\` | announcement + audience | \`{announce_id, recipients}\` | AnnouncementModal | server-side fan-out, one notification per recipient |
| \`announcement_recipient_count(p_audience, p_mentions)\` | audience | count | AnnouncementModal | composer preview |
| \`announcement_notify_update(p_announce)\` | announcement id | count | AnnouncementModal | explicit re-notify on edit (never automatic) |
| \`bootstrap_command\` / \`bootstrap_director(email)\` | email | text | nobody (setup-era) | first-user bootstrap; candidates for removal |

### DOJ legal-review RPCs (v1.13.0, minimal-DOJ revival 2026-08-15)

> **Minimal DOJ (Phase 2) — see [DOJ-INTEGRATION.md](../DOJ-INTEGRATION.md)
> Phase-2 banner.** The pipeline is \`cid_supervisor_review\` → (the responsible
> bureau's Bureau Lead — or ANY eligible Lead for a JTF-assigned case, with
> DD/Director/Owner as the audited fallback — via
> \`review_legal_request_as_cid\`) → **\`prosecutor_queue\`** (**bureau-scoped**
> since 20260818120000: one queue per bureau; a prosecutor holds ONE home
> bureau and works only their own queue, the AG sees all three and grants
> temporary audited coverage) → \`prosecutor_review\` → \`submitted_to_judge\` →
> \`judicial_review\` → approved/denied → CID fulfilment. Judge-/prosecutor-
> returned requests resubmit straight back to the prosecutor queue unless the
> investigator explicitly declares a material change. Exactly three live
> roles (\`attorney_general\` / \`prosecutor\` / \`judge\`; legacy ADA/DA map to the
> effective role prosecutor). The Phase-1-retired ADA/DA/AG review, DOJ-intake
> routing (\`submit_legal_request_to_doj\`, \`reassign_legal_ada\`,
> \`set_legal_approval_route\`), bureau-coverage, and self-serve
> justice-membership-request RPCs **stay EXECUTE-revoked** (history only).

Justice identity and legal review are a **separate domain** (see
[\`docs/DOJ-INTEGRATION.md\`](../DOJ-INTEGRATION.md)). Every legal table is
SELECT-only for clients; these definer RPCs are the only write path.

| RPC | Purpose |
|---|---|
| \`create_legal_request\` / \`update_legal_draft\` | draft a warrant or subpoena on an accessible case |
| \`add_legal_exhibit\` / \`remove_legal_exhibit\` | build the deliberate packet (source validated against caller's own access) |
| \`submit_legal_request_to_cid(p_request, p_change_summary?, p_material_change?)\` / \`review_legal_request_as_cid\` | CID supervisor stage; **approve freezes a version and hands off to the responsible bureau's \`prosecutor_queue\`** (deny/return unchanged; sealed requests skip the bench fan-out and wait for AG assignment; a queue with no covering prosecutor alerts the AG + Owner). Resubmitting a judge-/prosecutor-returned request goes **straight back to the prosecutor queue** unless \`p_material_change=true\` — the declaration is logged (\`material_change_declared\`) and the request re-enters CID review |
| \`legal_claim_prosecutor(p_request)\` | atomic claim from the caller's **own bureau's** queue (home bureau + live coverage — \`private.prosecutor_bureaus_of\`; out-of-lane claims are refused with a pointer to AG coverage; sealed refused; creator/conflicted refused — \`private.legal_is_conflicted\`) |
| \`legal_assign_prosecutor(p_request, p_prosecutor, p_reason?)\` | AG/Owner formal assignment or reassignment (assignee must cover the request's bureau; reason required to take a claimed request; the ONLY path for sealed); conflicts never overridable |
| \`justice_set_coverage(p_user, p_bureau, p_reason, p_expires_at?)\` / \`justice_end_coverage(p_coverage, p_reason?)\` | AG/Owner grant + end **temporary cross-bureau coverage** for a prosecutor — explicit, dated, expiring, audited (\`PROSECUTOR_COVERAGE_GRANTED/ENDED\`), endable, never permanent |
| \`legal_request_case_brief(p_request)\` | the justice viewer's ONLY case surface: concise case summary (number/title/status/stage/unit/responsible bureau) + the request's referenced exhibits, finalized-report content, and media metadata — gated by \`private.can_view_legal_request\`, database-enforced |
| \`legal_return_to_prosecutor_queue(p_request, p_reason?)\` | the holder steps back — or the AG returns abandoned work — to the shared queue |
| \`review_legal_request_as_prosecutor(p_request, p_decision, p_note?, p_signature?, p_capacity?)\` | assigned prosecutor: approve → judicial queue / return (corrections required) / decline (terminal, reason required) / note; dual CID+DOJ members state their acting capacity |
| \`claim_legal_request_as_judge\` / \`assign_judge\` / \`decide_legal_request_as_judge\` | judicial claim (non-sealed) or formal assignment (AG/Owner/approving prosecutor; only path for sealed), then decision — approve (reasoning required, optional conditions + expiry) / deny / return; conflict-of-role + investigator-history checked |
| \`justice_appoint(p_user, p_role, p_reason?, p_bureau?)\` | DIRECT, immediate DOJ/judiciary assignment — no approval chain. A prosecutor appointment **requires the home bureau** (\`p_bureau\` ∈ \`major_crimes\`/\`street_crimes\`; forbidden for judge/AG). Authority: prosecutor/judge — active AG, DD+/Owner (**Owner only** for an Attorney General). An ACTIVE CID member (any rank/bureau, JTF included) is transferred inline in one transaction — settled \`member_transfers\` row, CID membership + assignments end, justice membership activates, and their open led cases are **reassigned to the acting authority as interim lead** (audited \`CASE_LEAD_INTERIM\` per case; command notified) — and requires DD+/Owner (a pure AG appoints only non-CID accounts). Inactive/unassigned accounts appoint directly. The staged transfer workflow below remains the deliberate hand-over-first alternative |
| \`case_set_stage(p_case, p_stage, p_reason)\` | the ONLY path to move \`cases.investigative_stage\` (intake → active_investigation → legal_process → enforcement_ready → pending_closure → closed — manual, never automatic); reason required; case lead / Senior Detective+ / Owner; audited \`CASE_STAGE_CHANGED\`; direct column writes are trigger-frozen |
| \`case_stage_history(p_case)\` | the member-visible stage trail (when / who / from → to / reason) for the case Record area — reads ONLY the \`CASE_STAGE_CHANGED\` audit rows of one case, gated on \`private.can_access_case\` (the audit log itself stays Owner-only); inaccessible cases return zero rows |
| \`media_designate_evidence(p_media, p_ref?, p_clear?)\` | promote a case upload to a designated **evidence record** (reference auto-generated when omitted; designating actor + timestamp recorded; original uploader/timestamps untouched) or clear a designation; uploader / Senior Detective+ / Owner; audited |
| \`set_justice_membership_active(p_target, p_active)\` | deactivate/reactivate a membership; deactivation auto-returns the member's unfinished work to the queues (nothing strands) |
| \`legal_admin_cancel(p_request, p_reason)\` | command/AG/Owner cancels a stuck, undecided request (decided/issued work untouchable here) |
| \`legal_mark_superseded(p_old, p_new, p_reason)\` | the ONLY correction path for issued instruments: links both directions, retires the old one, revokes live fulfilment; snapshots stay immutable |
| \`justice_migration_review()\` | Owner/AG migration report: legacy roles, **prosecutors without a home bureau**, dual identities, requests in retired states, inactive holders, **JTF cases missing a responsible bureau**, self-review conflicts |
| \`transfer_doj_request(p_user, p_direction, p_role, p_reason, p_bureau?)\` | CID Command proposes CID→DOJ (AG/Owner proposes DOJ→CID) — an organizational transfer, never account recreation; a prosecutor destination **requires the home bureau** (\`p_bureau\`), which activation stamps onto the membership |
| \`transfer_doj_decide(p_transfer, p_stage, p_decision, p_note?, p_retain_cid?, p_dual_expires_at?)\` | two-stage approval: CID stage (DD+/Owner), DOJ stage (AG/Owner; AG appointments Owner-only); temporary dual membership requires an expiry ≤ 90 days |
| \`transfer_handover(p_transfer)\` / \`transfer_doj_activate(p_transfer, p_reassignments?)\` | handover checklist (led cases, open work), then ONE transactional activation — refused while a led case lacks a named new lead |
| \`transfer_doj_cancel(p_transfer, p_reason?)\` | requester/command/AG/Owner cancels a pre-effective transfer |
| \`issue_legal_request\` / \`record_warrant_execution\` / \`record_warrant_return\` | CID-side warrant fulfilment (**a prosecutor or judge can never issue**) |
| \`record_subpoena_service\` / \`record_subpoena_compliance\` | CID-side subpoena fulfilment (materials link back to the case) |
| \`resolve_case_originating_bureau\` | Senior Detective+ SETS a JTF-assigned case's missing responsible bureau (\`major_crimes\`/\`street_crimes\` — never JTF, never a permanent-bureau case), Deputy Director+/Owner CHANGES an already-set one with a required reason. The server chain (\`private.legal_resolve_bureau\`: bureau → originating → case-number prefix → lead's division → creator's division) persists successful derivations automatically |
| \`close_legal_request\` / \`withdraw_legal_request\` | close / expire / revoke; creator withdraw (records preserved) |
| \`legal_search(q)\` | RLS-limited header search (SECURITY INVOKER — sealed rows undiscoverable) |
| \`legal_internal_notes(p_request)\` | prosecution/judicial-side internal notes (column-revoked otherwise) |
| \`justice_directory()\` / \`legal_request_people(p_request)\` | name resolution for justice-only users (no roster access) |
| \`mdt_wanted_current()\` | classification-safe wanted projection; effective status computed at read time |

### Security-testing RPCs (v1.14.0)

The \`security_test_runs\` table has **no client grants at all** (not even
SELECT) — these two audited definer RPCs are the only path in or out. The
browser never runs privileged tests and never sees fixture credentials.

| RPC | Purpose |
|---|---|
| \`security_test_report(p_suite, p_passed, p_failed, p_skipped, p_failures, p_commit, p_branch, p_release, p_source, p_duration_ms)\` | writer, callable **only by \`rls-test-%@cidportal.test\` accounts** — the live RLS suites report their own sanitized results (a vitest reporter posts after every \`npm run test:rls\`). Failures are re-sanitized server-side (short name/expected/actual strings only); newest 50 runs kept per suite; audit-logged |
| \`owner_security_overview()\` | reader, \`private.is_owner()\`-gated + audited — recent runs, live fixture-roster health checks, and leftover test-data counts for the Owner Console's Security & Audit section |

### Legal import RPCs (v1.15.0)

\`search_warrant\` is now a warrant subtype alongside \`arrest_warrant\`:
\`create_legal_request\` and \`submit_legal_request_to_cid\` accept it (a
search warrant requires a subject **or** at least one
\`form_data.search_targets\` entry — no mandatory Persons-registry suspect),
and it terminates at **Bureau Lead+** approval like every warrant (Retired
2026-07-22: the old CID → ADA → Judge routing is history-only — see
[DOJ-INTEGRATION.md](../DOJ-INTEGRATION.md) Phase-1 banner).

These two RPCs migrate historical in-city warrants into the DOJ workflow.
Both are **owner-only** (\`private.is_owner()\`) and are not wired to any
normal UI.

| RPC | Purpose |
|---|---|
| \`import_legal_warrant(p_case, p_subtype, p_title, p_priority, p_form, p_narrative, p_person, p_classification, p_source_submitted_at, p_source_submitter, p_import_key, p_exhibits)\` | owner-only, **idempotent** on \`import_key\` (a repeat key returns the existing row, zero duplicates); lands the request at \`submitted_to_doj\` intake (never approved / signed / issued / executed / MDT-projected); preserves the historical \`source_submitter\`/\`source_submitted_at\` **separate from** the real import actor (never falsifies \`auth.uid()\`); freezes an immutable submitted version; attaches reused canonical exhibits plus external links (external-link URLs must be http(s)); writes a \`LEGAL_IMPORTED\` audit row |
| \`import_rollback_by_key(p_import_key)\` | owner-only deliberate reversal — deletes the imported request and its children in dependency order but **never** deletes \`audit_log\`; appends a \`LEGAL_IMPORT_ROLLBACK\` audit row before removal; returns the number of requests rolled back |

### Shared case services (\`20261002130000\`)

Six definer RPCs that moved the case workspace's worst component-embedded
operations server-side. The portal calls them through
\`src/lib/services/{cases,reports}.ts\`; the future FiveM CID lane will call
the **same** functions — one implementation per operation, never two (see
[Ch. 21](21-integration.md)). Each gates on the exact \`private.*\` predicate
its old client path passed through.

| RPC | Request | Called from | Why it exists |
|---|---|---|---|
| \`case_create(p_bureau, p_title, p_summary?, p_priority?, p_area?, p_lead?, p_template?, p_case_number?)\` | bureau + fields | CaseModal | atomic create: \`can_create_case\` gate, collision-safe number minting under a per-bureau advisory lock (explicit-number collision errors — never a timestamp fallback), command-only lead choice (everyone else IS the lead), template-checklist expansion, \`CASE_CREATED\` audit |
| \`case_set_status(p_case, p_status, p_reason?)\` | case + status | CaseBoard drag, CaseDetail quick actions, CasesView bulk | validated vocabulary + \`CASE_STATUS_CHANGED\` audit; \`closed_at\` stays owned by the \`trg_case_closed_at\` trigger; transitions deliberately unconstrained (mirrors the old freedom) |
| \`case_set_lead(p_case, p_to, p_note?)\` | case + new lead | HandoverModal | the modal's lead-or-command rule promoted to a server gate; server-sent \`case_handover\` notifications to both sides; \`CASE_LEAD_CHANGED\` audit |
| \`case_access_decide(p_request, p_approve, p_note?)\` | request id + decision | AccessDecisionModal | atomic grant-insert + request-stamp under \`can_grant_case\` (the old client did two writes and could grant without stamping); closes the unaudited-grant gap (\`CASE_ACCESS_DECIDED\`); an already-decided request errors, changes nothing |
| \`case_timeline(p_case)\` | case id | TimelineTab | ONE definer read replacing 11 parallel client reads — gated on \`can_read_case\` with the narrower arms (legal holds, restricted trail, surveillance, media clauses) re-checked per-arm, so it exposes exactly what the client reads exposed |
| \`report_create(p_case, p_template, p_kind?, p_fields?)\` | case + template | ReportsTab (create path) | server-computed per-(case, template, kind) seq under an advisory lock; author pinned to \`auth.uid()\` (never a parameter); \`REPORT_CREATED\` audit |

The **machine-only bridge functions** — \`mdt_patrol_feed\`,
\`bridge_ingest_event\`, \`mdt_bridge_ack\` — are deliberately absent from the
client list above: EXECUTE is service_role-only and no consumer is deployed.
See [Ch. 21](21-integration.md) and
[\`docs/archive/MDT-BRIDGE-CONTRACT.md\`](../archive/MDT-BRIDGE-CONTRACT.md).

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
| \`bureau\` | major_crimes, street_crimes, special_investigations, JTF *(renamed in place 2026-08-25 — was LSB/BCB/SAB; \`special_investigations\` is SIB-authority cases only, \`JTF\` a temporary joint designation)* |
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
append-only \`custody_chain\`), \`reports\` (finalize RPC-only) +
\`report_versions\` (v1.14: one immutable snapshot per seal, written only
inside \`report_finalize()\` — SELECT follows the report's case access, client
UPDATE is trigger-blocked and write grants are revoked; rows CASCADE with
their report because reports stay client-deletable),
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
active member's browser. **Deleted by** command via \`deleteRecord\` → \`soft_delete\` (restorable from the Trash — [Ch. 22](22-versions-trash.md)).

### Own-row (keyed to \`auth.uid()\`)
\`notifications\` (insert ONLY via RPC — actor can't be forged; since
\`20260826010000\` \`create_notification\` drops an identical unread duplicate
created within the last hour), \`watchlist\`,
\`shift_reports\` (command may read/update all), \`feedback\` (+2 triage
owners), \`profiles\` (self-update allowed; \`guard_profile\` trigger blocks
self-changing role/active/bureau; \`email\` column readable by command only),
and the three **personalization tables** (\`20260826010000_ux_personalization.sql\`,
the \`document_user_state\` contract): \`user_pins\` (pinned record refs, ids
only), \`user_drafts\` (autosaved drafts, 64 KiB jsonb cap, touch-trigger
\`updated_at\`), \`user_prefs\` (small keyed jsonb ≤32 KiB — saved views,
notification mutes). All three are **owner-only in every direction** (RLS
admits only \`user_id = auth.uid()\`, which also defaults server-side), carry
no audit triggers and are not in the realtime publication — they hold
convenience state, never shared records.

### System
\`audit_log\` (written ONLY by the \`private.audit()\` trigger and the
membership/joint/announcement RPCs; readable by one owner UUID; append-only
in SQL since \`20261006120000\` — \`UPDATE\`/\`DELETE\`/\`TRUNCATE\` refused by
trigger, every row hash-chained via \`prev_hash\`/\`row_hash\`, verified daily by
the \`audit-chain-verify\` job and on demand by \`audit_chain_status()\`),
\`announcements\` (write = \`can_announce()\` + \`can_post_audience(audience)\`;
SELECT is audience-scoped: 'all', own division, 'command' for command,
'members' for mentioned users, author, command/owner oversight),
\`membership_requests\` (one per applicant; INACTIVE applicant inserts/edits
own form fields — since v1.16 every normal CID role is requestable
(detective … director; Owner is a flag, not a role; JTF still CHECK-blocked) —
decision columns trigger-frozen, \`internal_decision_note\` column-revoked —
command reads via \`admin_membership_requests()\`) + append-only
\`membership_request_history\` (definer-RPC writes only),
\`role_events\` (append-only assignment history; v1.16 adds \`reason\`,
\`source\` — membership_approval / role_change / transfer / activation — and
\`source_id\` linking back to the request/transfer, making the latest event
the member's assignment-provenance record; SELECT command/owner only),
\`transfer_requests\` (the department-move ledger — **single-step since
\`20260807040000\`**: an authorized \`request_transfer\` stamps both sides
approved and applies the move in the same call; JTF is a valid source and
destination since \`20260807020000\`; the \`pending_*\`/\`approved\` states and
approve/reject/cancel/complete RPCs survive only to resolve pre-existing
open rows; one open transfer per member via a partial unique
index; SELECT is **bureau-scoped**, not command-wide — the target officer,
the requester, Bureau Leads of the source/destination bureaus, and Deputy
Director+/Owner; an unrelated bureau's Lead sees no rows, counts, or
realtime events; ALL writes via the \`*_transfer\` definer RPCs — see
[Ch. 7](07-api.md)),
\`app_secrets\` (RLS on, **zero policies** = invisible to all client roles —
deliberate), \`security_test_runs\` (v1.14: **all client grants revoked** —
written only by \`security_test_report()\` from the rls-test fixture suites,
read only through the owner-gated \`owner_security_overview()\`; newest 50
runs kept per suite — see [Ch. 7](07-api.md)).

### Justice / legal (SELECT-only for clients; every write is a definer RPC)
> **Retired 2026-07-22** — the justice-review/membership RPCs are EXECUTE-revoked and \`justice_memberships\` are deactivated (rows preserved read-only); legal-request approval is now **Bureau Lead+** via \`review_legal_request_as_cid\`. See [DOJ-INTEGRATION.md](../DOJ-INTEGRATION.md) Phase-1 banner. The tables themselves are unchanged.

The DOJ Legal Review System's tables (\`justice_memberships\`,
\`justice_membership_requests\`, \`prosecutor_bureau_assignments\`,
\`legal_requests\` + \`legal_request_versions\`/\`_actions\`/\`_exhibits\`/
\`_participants\`/\`_signatures\`, \`mdt_wanted_projections\`) are a **separate
identity domain** — no INSERT/UPDATE/DELETE grants exist; the transactional
SECURITY DEFINER RPCs in [Ch. 7](07-api.md) are the only write path (see
[\`docs/DOJ-INTEGRATION.md\`](../DOJ-INTEGRATION.md)). \`legal_requests\`
carries \`request_type\` (warrant / subpoena) and a \`subtype\` CHECK — the
warrant subtypes are \`arrest_warrant\` **and \`search_warrant\`** (v1.15), a
compound CHECK pinning warrant subtypes to \`request_type='warrant'\`. v1.15
also added six nullable **import-provenance** columns, populated only on
owner-imported rows: \`source_system\`, \`source_submitted_at\`,
\`source_submitter_id\` (→ \`profiles\`), \`imported_by\` (→ \`profiles\`),
\`imported_at\`, and \`import_key\` (a partial-unique index enforces idempotent
imports where the key is present). See \`import_legal_warrant()\` in
[Ch. 7](07-api.md).

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
| \`private.audit()\` AFTER I/U/D | every audited table (see the schema snapshot) | The app's audit logging — no client write path |
| \`private.audit_detail()\` AFTER I/U/D | the relationship-link tables (\`person_relationships\`, \`person_places\`, \`person_vehicles\`, \`gang_places\`, \`case_intel_links\`, \`account_links\`) | Audit rows that also snapshot **old/new row jsonb** into \`audit_log.detail\` — a link edit (confidence/status/role/note, via \`LinkEditPopover\`) records what changed, not just that it changed (\`20260826010000\`) |
| \`touch\` family BEFORE UPDATE | most tables (see the schema snapshot) | Honest \`updated_at\` (drives staleness + analytics) |
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
  any UI constant (\`CASE_STATUSES\`, indicator \`KINDS\`) together.

## 8.8 Later additions (post-v1.16)

This chapter's inventory predates several table families added since; each
is documented where its rules live — [\`docs/AUTHORIZATION.md\`](../AUTHORIZATION.md),
[\`docs/WORKFLOWS.md\`](../WORKFLOWS.md), and [\`docs/DOJ-INTEGRATION.md\`](../DOJ-INTEGRATION.md) —
and the schema snapshot is the complete table list:

- **Case bureau reassignment** (\`20260725010000\`) — frozen \`cases.bureau\`,
  \`case_reassign_bureau()\` (DD+/Owner).
- **Permanent deletion** (\`20260726010000\`) — \`deleted_member_ledger\`,
  \`deletion_tokens\`, the system tombstone profile, \`permanent_delete_*\` RPCs.
- **Case blockers & priority** (\`20260727010000\`) — \`case_blockers\`,
  \`cases.priority\`.
- **Person intelligence** (\`20260729010000\`) — \`person_relationships\`,
  \`person_places\`, \`person_vehicles\`, \`search_persons\`, \`person_merge\`.
- **Document governance** (\`20260801\`–\`20260802\`) — classification,
  acknowledgement, campaigns, suggestions on \`documents\`.
- **Narcotics intelligence + restricted sales** (\`20260803\`–\`20260804\`).
- **Parallel judiciary + structured legal targets** (\`20260805\`–\`20260806\`).
- **Single-step transfers, every department** (\`20260807020000\`–\`20260807040000\`)
  — JTF valid as source/destination; an authorized \`request_transfer\`
  applies the move immediately.
- **Case archival + Owner-only permanent deletion** (\`20260807130000\`) —
  \`cases.archived_at/by\` (trigger-guarded), \`case_archive\`/\`case_restore\`
  (command, restorable), \`case_delete_preview\`/\`case_permanent_delete\`
  (Owner only; refuses cases with legal requests).
- **UX personalization pass** (\`20260826010000\`, mapped in
  \`supabase/MIGRATION-HISTORY.md\`) — \`user_pins\`/\`user_drafts\`/\`user_prefs\`
  (owner-only, see 8.2), \`private.audit_detail()\` old/new link snapshots
  (see 8.5), the missing \`case_intel_links\` UPDATE policy (role/note
  editable; the legal-hold trigger still vetoes), the \`create_notification\`
  1-hour dedupe guard, and \`search_all\` \`bolo\` + \`task\` arms (+ a
  \`case_tasks\` title trgm index).
- **FiveM integration prep — dormant data layer** (\`20261002120000\`) — six
  tables for the future city integration: \`integration_sources\` and
  \`integration_events\` are command/owner **SELECT-only** audit surfaces (no
  write policies); \`external_links\`, \`external_storage_refs\`,
  \`external_media_refs\` and \`external_officer_identities\` are **fully
  sealed** (RLS on, zero policies, all privileges revoked). No seeds, no
  RPCs, no realtime. Also fixes the \`mdt_wanted_projections.sync_status\`
  CHECK to admit \`'retryable'\`. See [Ch. 21](21-integration.md).
- **Shared case services** (\`20261002130000\`) — no tables; six definer RPCs
  (\`case_create\`, \`case_set_status\`, \`case_set_lead\`, \`case_access_decide\`,
  \`case_timeline\`, \`report_create\`) that both the portal and the future city
  lane call. See [Ch. 7](07-api.md).
- **Portal Improvements, Phases 0–8** (\`20261004…\` → \`20261102…\`; each
  verified at apply time in \`supabase/MIGRATION-HISTORY.md\`) — the
  **scheduler** (\`pg_cron\` + \`pg_net\`, \`scheduled_job_runs\`,
  \`private.job_begin/job_end\`; seven jobs — [Ch. 22.5](22-versions-trash.md));
  the **permission module** (\`permission_catalog\`, \`my_permissions()\`,
  \`can_record()\`, \`private.perm_dispatch\`, the denial ledger — \`perm_deny\` /
  \`perm_raise\` P0403 / \`perm_denied_ack\`); the **audit chain**
  (\`audit_log.prev_hash / row_hash\`, rewrite blocked, \`audit_chain_status()\`);
  **soft delete** on 27 tables (\`deleted_at / deleted_by / delete_reason /
  delete_batch\`, \`DELETE\` revoked, \`private.block_direct_soft_delete\`,
  \`soft_delete\` / \`restore_record\`, \`private.soft_delete_table/_state\`,
  \`perm_registry_visible/_edit/_delete\`) and the **Trash** (\`trash_list\` /
  \`trash_count\` — [Ch. 22.2](22-versions-trash.md)); **\`record_versions\`**
  (definer trigger \`private.version_row\`, INVOKER policy
  \`private.version_visible\`, \`record_history\` / \`restore_version\`, the prune);
  **case access grant expiry** (\`expires_at\` ≤ 90 d, \`case_access_renew\`,
  the hourly sweep); the **generalised permanent deletion**
  (\`deleted_record_ledger\`, \`deletion_tokens.target_kind\`,
  \`permanent_delete_record_preview/_arm/_execute\`); the **entity layer**
  (\`phone_normalized\` / \`value_normalized\`, \`entity_merges\`,
  \`entity_field_observations\`, \`entity_update_suggestions\`,
  \`siu_reconcile_queue\`, \`siu_hidden_flag\`, \`merged_into\`); the **workspace**
  (\`case_notes\` — authored, versioned, soft-deletable; \`case_links\`;
  \`private.case_writable\` on 36 case-child policies); the **legal tables**
  (\`legal_request_charges / _comments / _comment_versions / _revision_items /
  _target_decisions / _reminders\`, \`legal_expiry_defaults\`, \`legal_export_log\`,
  \`stage_entered_at / nudged_at / escalated_at\`); the **report builder**
  (\`report_templates\`, \`report_template_versions\`, \`reports.template_version_id\`
  + review columns, \`report_entities\`, \`report_exports\`, \`case_tasks\` waive
  columns); **intel triage** (\`rejected_* / validated_*\`,
  \`field_submission_events\` shadow, \`intel_groups / _members / _cases\`,
  \`field_claim_links\` widened, \`source_submission_id\` on six registries,
  \`private.block_direct_intel_review_columns\`); the **Action Center**
  (\`action_item_state\` — PK user + key, RPC-only; \`action_escalation_rules\`;
  \`action_escalations\`; \`notifications.read_at\` + the \`read\` column grant;
  \`user_prefs.notif_discord\`). Realtime additions: \`case_notes\`, \`case_links\`,
  \`legal_request_comments\`, \`field_submission_events\`, \`action_item_state\`,
  \`action_escalations\` (identifiers only — never a table with text).`,
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
| React Context | Two: \`AuthProvider\` (session/profile/capabilities) and \`ToolsWorkspaceContext\` (the Investigative Tools workspace — open tabs, active key, open/close/dirty ops; \`useToolsWorkspace()\` returns null outside \`/tools\` so hosted views no-op) | \`lib/auth.tsx\`, \`components/tools/ToolsWorkspaceContext.tsx\` |
| zustand stores | Toasts, dialogs, realtime versions, profiles cache, operations cache, watchlist, pins, draft save-state — singletons that non-React code must reach | \`lib/*\`, \`ui/dialog\` |
| localStorage (\`Store\`) | Device preferences + legacy-app continuity, ONE JSON blob (\`cid-portal-v3\`); includes the ids-only recents trail (\`lib/recents.ts\`) | \`lib/store.ts\` |
| localStorage (\`Drafts\`) | Draft mirror keys (\`cid-draft:…\`) — \`lib/userDrafts\` mirrors per-user (\`u:<uid>:<key>\`) before every server save; legacy shared keys survive for the legal stash | \`lib/drafts.ts\` |
| sessionStorage | Investigative Tools open tabs, per signed-in user, **ids only** (\`cid-tools-workspace:<uid>\`) — titles are re-fetched RLS-scoped on restore, invisible rows close silently | \`components/tools/ToolsView.tsx\` |
| **Per-user DB state** | Cross-device personal state, owner-only RLS, never shared data: \`user_pins\` (pinned records, ids only — \`lib/pins.ts\`), \`user_drafts\` (autosaved drafts, 64 KiB cap — \`lib/userDrafts.ts\`), \`user_prefs\` (small keyed jsonb: saved views \`views:<section>\` — \`lib/savedViews.ts\`; notification mutes \`notif_muted\` — \`lib/notifications.ts\`) | Supabase |
| The database | ALL shared data — every screen refetches on mount and on realtime bumps | Supabase |

**Personalization rule**: anything per-user that should follow the member
across devices goes in one of the three \`user_*\` tables above (owner-only
RLS, no audit triggers, no realtime, size-capped jsonb); anything genuinely
device-local goes in the \`Store\` blob. Ids only for anything referencing
records — consumers re-resolve titles through the viewer's RLS at render, so
lost access hides entries instead of leaking stale labels. Don't invent a
fourth mechanism.

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
        │  app/(app)/[tab]/page.tsx ── the feature views               │
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
- \`shared/RecordSearchPicker\` ← ~23 files (the one "attach a record"
  contract) · \`lib/entitySearch\` ← ~14 components (its loaders)
- \`src/components/guides/docs/*.ts\` ← the guides' prose; \`guides.body_key\` joins a library row to one`,
  },
  {
    slug: "integration",
    title: "City Integration & Bridges",
    section: "Data & API",
    body: `Everything that connects (or is prepared to connect) the portal to the city
— the FiveM server, its patrol MDT, its evidence storage and media hosts.
**Status: dormant.** Every surface in this chapter ships in code and schema
but nothing is live: no consumer is deployed, no external caller is
registered, and the portal behaves exactly as if none of it existed. This
chapter is the map; the contracts themselves live in
[\`docs/archive/MDT-BRIDGE-CONTRACT.md\`](../archive/MDT-BRIDGE-CONTRACT.md) and
[\`docs/integration/CID-INTEGRATION-API.md\`](../integration/CID-INTEGRATION-API.md)
— read those, don't duplicate them.

## 21.1 The two lanes

1. **Patrol lane** — machine-to-machine, minimal, sanitized (wanted/BOLO
   data out, automated surveillance observations in). Never carries case
   data.
2. **CID lane** — authenticated, per-officer casework from a future in-city
   CID app. Every operation runs as the officer's own portal identity, so
   all existing RLS/RPC authority applies unchanged.

The lanes never mix: a patrol MDT never gains CID reach, and the CID lane
never widens the patrol feed's allowlist.

## 21.2 The patrol bridge (the three machine functions)

| Function | Direction | What it does |
|---|---|---|
| \`mdt_patrol_feed()\` | outbound | The nine-column read surface: snapshot text only — no case ids, no entity FKs. The allowlist is structural (the feed *selects* only those columns), so sensitive CID/SIB data cannot cross by construction. |
| \`bridge_ingest_event(...)\` | inbound | Surveillance observations: idempotent on \`(source, source_event_id)\`, malformed payloads quarantined (never discarded), everything unverified until detective review in the Action Center. |
| \`mdt_bridge_ack(...)\` | bookkeeping | Stamps sync outcomes onto \`mdt_exports\` / \`mdt_wanted_projections\` (\`20261002120000\` fixed the wanted-branch CHECK to admit \`'retryable'\`). |

**Dormancy mechanism**: all three are SECURITY DEFINER with EXECUTE granted
to \`service_role\` **only** — revoked from \`authenticated\`/\`anon\`, so they
are unreachable from the browser and the app runtime; the RLS suite asserts
this. No sync service is deployed. Full field semantics, expiry rules and
consumer expectations: [MDT-BRIDGE-CONTRACT.md](../archive/MDT-BRIDGE-CONTRACT.md).

## 21.3 The integration data layer (six tables, \`20261002120000\`)

The dormant schema the CID lane will write. Two postures:

| Table | Purpose | Posture |
|---|---|---|
| \`integration_sources\` | registry of trusted external callers; \`enabled\` defaults false; \`secret_ref\` is a *pointer* to a secret held outside the DB, never the secret | **read-only** (command/owner SELECT; no write policies) |
| \`integration_events\` | idempotency + audit envelope, \`UNIQUE (source, external_event_id)\`; \`payload_meta\` carries safe metadata only, never raw city payloads | **read-only** (command/owner SELECT; no write policies) |
| \`external_links\` | generic CID record → city record reference \`(entity, source, external_type, external_id)\` + deliberate \`snapshot\` | **sealed** |
| \`external_storage_refs\` | case → city physical-storage item (CID references, never owns; frozen custody facts) | **sealed** |
| \`external_media_refs\` | city-hosted media reference (durable URL pointer, never a copy) | **sealed** |
| \`external_officer_identities\` | city officer → portal profile mapping; \`active\` defaults false; pairs with the reserved \`case_assignments.assignment_source='manual_access'\` lane | **sealed** |

**Sealed** = RLS enabled, zero policies, every privilege revoked from
\`authenticated\`/\`anon\` (the \`app_secrets\` /\`field_submission_sources\`
posture) — unreachable through PostgREST at any rank. No table is seeded,
none is in the realtime publication, and no RPC writes any of them; the
absence of rows means the absence of integration. A future activation pass
(separate migration, separately reviewed) adds the definer RPCs and
entity-scoped read policies.

## 21.4 Shared case services (\`20261002130000\`)

Six SECURITY DEFINER RPCs that moved the worst component-embedded case
operations server-side, so the portal and the future city lane run **one
implementation per operation, never two**. The portal is rewired onto them
via [\`src/lib/services/cases.ts\`](../../src/lib/services/cases.ts) /
[\`reports.ts\`](../../src/lib/services/reports.ts); each gates on the same
\`private.*\` predicate its old client path passed through:

| RPC | Replaces | Gained |
|---|---|---|
| \`case_create\` | CaseModal's non-atomic insert + checklist | one transaction, collision-safe number minting (an explicit-number collision now errors — never a timestamp fallback), server-held lead rule |
| \`case_set_status\` | three direct \`cases.status\` update sites | validated vocabulary, explicit \`CASE_STATUS_CHANGED\` audit; \`closed_at\` stays trigger-owned |
| \`case_set_lead\` | HandoverModal's raw update + client notifies | lead-or-command gate server-side, server-sent handover notifications, audit |
| \`case_access_decide\` | AccessDecisionModal's two non-atomic writes | atomic grant + stamp, closes the unaudited-grant gap |
| \`case_timeline\` | TimelineTab's 11 parallel client reads | one definer read model exposing exactly what the client reads exposed |
| \`report_create\` | ReportsTab's insert with client seq/author | server-computed seq under an advisory lock, author pinned to \`auth.uid()\` |

Details per function (parameters, gates, audit actions): the migration
header of
[\`20261002130000_shared_case_services.sql\`](../../supabase/migrations/20261002130000_shared_case_services.sql)
and the [Ch. 7](07-api.md) table.

## 21.5 The CID lane contract and the developer package

- **Contract**: [docs/integration/CID-INTEGRATION-API.md](../integration/CID-INTEGRATION-API.md)
  — identity exchange, the service-role raw-write prohibition, the error
  vocabulary, the operations catalog, idempotency and external-ID/ownership
  rules. \`supabase/functions/cid-integration/\` is its **undeployed**
  code-shaped counterpart (every handler returns \`not_activated\`; deploying
  it *is* the activation step — see that function's README).
- **TypeScript contracts**: [\`src/lib/integration/\`](../../src/lib/integration/index.ts)
  — \`External*\` record shapes, provider interfaces, idempotency helpers and
  a mock adapter. Nothing in app code imports this directory **by design**;
  only the unit tests and mock consume it.
- **Developer package**: [\`integration-package/\`](../../integration-package/README.md)
  — the standalone handoff a city developer receives *without* this repo:
  the public half of the contract, self-contained types, examples, adapter
  guides, a zero-dependency mock, and a server-side FiveM resource skeleton.
  No credentials, hostnames or project references anywhere in it.

**The hard rules**, wherever activation lands: secrets live outside the
database; the service-role key never ships in a FiveM client resource, a
browser, or the portal runtime; raw service-role table writes are forbidden
(guard triggers are \`current_user\`-based and transparent to service_role);
and city data is referenced, never mirrored — snapshots are explicit and
deliberate.`,
  },
  {
    slug: "versions-trash",
    title: "Versions, Trash and the scheduler",
    section: "Data & API",
    body: `Three mechanisms the Portal Improvements plan (Phases 0–8, release 1.18.0)
added underneath every screen: **nothing a browser session does destroys a
row** (soft delete + the Trash), **every covered edit leaves a version**
(record history + restore), and **the database runs its own maintenance on a
clock** (pg_cron). This chapter is the developer's map; the authority rules
are in [\`docs/AUTHORIZATION.md\`](../AUTHORIZATION.md) §8–§12 and §20, the
member's view in [\`docs/WORKFLOWS.md\`](../WORKFLOWS.md) §13–§14.

## 22.1 Soft delete — the vocabulary

Twenty-seven **kinds**, each a table: the 15 registries (\`person\`, \`vehicle\`,
\`gang\`, \`place\`, \`account\`, \`indicator\`, \`narcotic\`, \`operation\`, \`tracker\`,
\`gang_member\`, \`gang_turf\`, \`person_place\`, \`person_vehicle\`,
\`person_relationship\`, \`account_link\`), the 10 case tables (\`case\`, \`report\`,
\`media\`, \`evidence\`, \`case_task\`, \`case_message\`, \`case_intel_link\`,
\`case_blocker\`, \`rico_case\`, \`predicate_act\`) and the Phase 3 pair
(\`case_note\`, \`case_link\`). The server's map is
\`private.soft_delete_table(kind)\`; the client's is \`SOFT_DELETE_KIND\` in
\`src/lib/db.ts\` (table → kind) — \`tests/msw/permission-semantics.test.ts\` and
\`src/mocks/handlers/trash.test.ts\` pin the two in sync.

Each table carries \`deleted_at / deleted_by / delete_reason / delete_batch\`.
The \`SELECT\` and \`UPDATE\` policies were re-emitted with
\`(private.is_live(deleted_at) or private.is_owner())\` prepended — a deleted
row exists only for the Owner and for the definer RPCs; the \`DELETE\` policy
is dropped and the privilege **revoked** (a client DELETE is \`42501\`); a
non-definer \`BEFORE INSERT OR UPDATE\` trigger (\`private.block_direct_soft_delete\`)
refuses any client write to the four columns. So there are exactly two
paths:

| RPC | What | Authority |
|---|---|---|
| \`soft_delete(kind, id, reason)\` | marks the row and cascades to its **exclusive** children (a case: reports, media, evidence, tasks, messages, intel links, blockers, RICO material, notes, links; a person: its link rows; …) under one \`delete_batch\`. A reason is required for the parent kinds (\`REASON_REQUIRED\` in db.ts). Refuses under an active legal hold (\`held\`). Returns \`{ok:false, code}\` — never raises — so the \`PERMISSION_DENIED\` row commits. | \`can_record('soft_delete', kind, id)\` = the former \`*_del\` predicate, verbatim (\`private.perm_registry_delete\`) |
| \`restore_record(kind, id, reason)\` | brings the row back; a parent kind brings its batch; a child comes back only under a live parent (\`parent_deleted\`). | the same delete authority, or the Owner |

Client: \`list()\` / \`countRows()\` filter these tables to live rows
(\`includeDeleted\` opts in); \`remove()\` routes to \`soft_delete\`;
\`src/lib/deleteRecord.ts\` is the **one delete helper** — confirm → reason
prompt when required → \`soft_delete\` per row → the toast "<Label> deleted ·
In Trash" with **Undo** (\`restore_record\`) and an "Open Trash" link. The
former \`deleteWithUndo\` and its snapshot-and-reinsert branch are gone; only
\`case_templates\` and \`commendations\` (a plain confirmed \`remove()\`) and
\`case_assignments\` (an unassignment through \`case_assignment_end\` — Bureau
Lead+, stamps \`removed_at\` / \`removed_by\`, \`CASE_UNASSIGNED\`; the client can no
longer set \`removed_at\`) do not soft-delete. A task's delete does not cascade
to its sub-tasks.

## 22.2 The Trash

\`public.trash_list(p_kind default null, p_limit default 300)\` (SECURITY
DEFINER, \`20261102120000\`) walks every kind — or the one asked for — with one
\`execute format(...)\` per table over \`deleted_at is not null\` and **keeps a
row only when \`private.perm_dispatch('restore', kind, id)\` holds for the
caller**. That single rule is the whole access model of the Trash: a
detective sees the case material they authored on cases they reach, the
links they created and any account link; command sees every deleted row of
the cases they reach and the registry rows; narcotics are the Owner's; the
Owner sees everything; an inactive caller sees nothing. Each row is
projected — \`kind, id, label, case_id, case_number, deleted_at, deleted_by,
deleted_by_name, delete_reason, delete_batch, restorable, permanently_deletable\`
— never the record itself: \`label\` is \`private.permanent_delete_record_label\`
(case_number → name → plate → title → label → item_code → value → code →
the id), \`case_id\` comes from \`private.trash_case_expr\` (the case, the row's
\`case_id\`, the RICO parent's case), \`permanently_deletable\` is
\`private.is_owner()\`. \`p_limit\` is clamped 1–500 across all kinds, newest
first; an unknown kind raises \`unknown record kind\`. The security review
added two walls: a case child is listed only while the caller can still
**read** the case (\`private.can_read_case\`), and a restricted media row only
for the Owner. \`trash_count()\` counts to 100 — the Sidebar badge (99+
beyond). The catalog row is \`('list','trash')\`
and the \`perm_dispatch\` arm \`trash · list = private.is_active()\`.

Client (\`src/lib/trash.ts\`, \`src/components/trash/TrashView.tsx\`, route
\`/trash\` in the Oversight category next to Audit): \`fetchTrash(kind?)\`,
\`TRASH_GROUPS\` (Cases / Case material / Registry / Links), \`trashRowLabel\`,
\`trashHref\` (the deep link to where the row lives once restored),
\`restoreFromTrash\` → \`restoreRecord\` (translating \`parent_deleted\` into
"Restore the record this belongs to first"), the badge store
(\`useTrashCountStore\`, \`bumpTrash()\` after a delete / undo / restore). The
view refreshes on focus, after an action and every 60 s — twenty-seven tables
is too broad for \`useTableVersion\`. The Owner's **Permanently delete…** runs
inline from the row (\`shared/RecordPermanentDelete.tsx\`, the generalised
armed protocol: preview → arm with a fresh session and a reason → the typed
\`DELETE <label>\` typed into a real confirmation field and passed verbatim to
\`_execute\`, every server error verbatim); everyone else never
sees the button and RLS refuses anyway.

## 22.3 Record history and restore

\`record_versions\` (\`20261011120000\`): a definer \`AFTER UPDATE\` trigger
(\`private.version_row\`) writes \`old\`, \`new\`, \`changed_fields\`, \`actor_id\`,
\`reason\`, \`source\` for cases, persons, vehicles, gangs, places, accounts,
narcotics, evidence, reports (unsealed only), legal requests (draft columns),
field submissions and case notes; same-actor bursts inside five minutes
coalesce into one version; noise columns (\`updated_at\`, the lifecycle
columns, generated keys) never version. The table's policy is
\`private.version_visible\` — **SECURITY INVOKER**, "can you see the parent
row?" under the caller's own RLS — and there is no client write.

| RPC | What | Authority |
|---|---|---|
| \`record_history(kind, id)\` | the versions, newest first | as the parent row |
| \`restore_version(kind, id, version_no, reason)\` | writes the version's \`changed_fields\` back as an ordinary UPDATE (minus RPC-governed columns), so it lands as a **new** version with \`source='restore'\`; \`RECORD_VERSION_RESTORED\` | \`can_record('restore_version', kind, id)\` = the edit authority, and a reason |

Client: \`src/lib/recordHistory.ts\` (\`historyRows\`, \`versionChanges\`,
\`compareVersions\`, \`VERSION_KINDS\`) and \`shared/RecordHistory.tsx\` — field
changes per version (jsonb / long text through \`DiffView\`), **Compare** any
two, **Restore this version** only when \`canRestore\` (the caller passes the
\`can_record\` answer or the local edit mirror). Mounted on the person /
vehicle / gang dossiers, the case Overview ("History" disclosure), notes,
report drafts (sealed reports keep the read-only viewer), draft legal
requests (compare only) and intel records; \`VersionViewer\` stays for SOP
document versions. Retention: \`private.record_versions_prune()\` — older than
two years, never the latest five per record, never a record on an open case
or under a legal hold — runs daily.

## 22.4 Permanent deletion

The Owner's armed protocol is the only way a row leaves the database
(\`20261013120000\`, generalising Phase B's member protocol): the record must
already be in the Trash (a case may also be archived); \`permanent_delete_record_preview\`
walks every foreign key pointing at it (**blockers** — live dependants and
an active hold; **destroyed** — the batch and cascade keys; **unlinked** —
SET NULL keys; storage paths), \`_arm\` needs \`private.assert_fresh_session()\`
and a reason and mints a 5-minute single-use \`deletion_tokens\` row, \`_execute\`
needs the token and the exact \`DELETE <label>\` and writes
\`deleted_record_ledger\` (Owner-readable) before deleting leaf-first. The
database cannot delete storage objects — they are enumerated for the client.
\`case_permanent_delete\` is a wrapper over the same apply.

## 22.5 The scheduler

\`20261004130000_scheduler_pg_cron\` declares \`pg_cron\` + \`pg_net\` in the repo
(pg_net had been missing since the 2026-09-01 restore) with the
\`scheduled_job_runs\` ledger and \`private.job_begin(name)\` /
\`job_end(run, status, detail)\` around every job. Each job is a thin
\`private.*_job()\` around an idempotent \`private.*_sweep()\` so a manual re-run
after a gap is safe, and each notifies through the same test-actor-suppressing
notifier its RPC family uses.

| Job | Schedule | Does |
|---|---|---|
| \`sops-sync\` | every 15 min | Drive → SOPs through pg_net (secret from \`app_secrets\`) |
| \`audit-chain-verify\` | 03:15 daily | walks the \`audit_log\` hash chain; \`audit_chain_mismatch\` to the Owner on the first bad row; \`audit_chain_status()\` reads the result |
| \`record-versions-prune\` | 03:45 daily | \`private.record_versions_prune()\` (22.3) |
| \`access-grant-expiry-sweep\` | :20 hourly | \`access_expiring\` three days out, \`ACCESS_EXPIRED\` + removal on lapse |
| \`siu-reconcile-scan\` | every 15 min | late collisions between CID-visible and SIB-hidden records → \`siu_reconcile_queue\` |
| \`legal-sweep\` | :35 hourly | nudge / escalate / unissued / expiring reminders, warrant expiry → MDT \`expired\` |
| \`action-escalation-sweep\` | :50 hourly | the enabled \`action_escalation_rules\` → one \`action_escalations\` row per source, \`action_escalated\` on (re)open |

Manual runners for the Owner: \`legal_sweep_run()\`, \`action_escalation_run()\`
(both \`{ok:false, code:'denied'}\` for anyone else); the RLS suite drives the
escalation ladder through the fixture-scoped \`rls_test_escalation_run(case)\`.
The operations view — what to check, how to re-run — is
[\`docs/OPERATIONS.md\`](../OPERATIONS.md) §6 "Scheduled jobs".

## 22.6 Tests

\`tests/rls/v180a\` / \`v180b\` (soft delete + restore), \`v183\` (versions), \`v185\`
(the protocol), \`v190a\` (the Trash); MSW \`src/mocks/handlers/trash.ts\`
(\`trash_list\` / \`trash_count\` over the mock store with the restore-authority
rule) and \`rpc.ts\` (\`soft_delete\` / \`restore_record\`), \`caseWorkspace.ts\`
(\`record_history\`); unit \`src/lib/trash.test.ts\`, \`deleteRecord.test.ts\`,
\`recordHistory.test.ts\`; e2e \`tests/e2e/trash.spec.ts\` (delete → Undo →
\`/trash\` → Restore).

## 22.7 Traps

- **Never \`.delete()\` a soft-deletable table from the client** — the
  privilege is revoked; use \`deleteRecord\` / \`remove()\` and let the RPC decide.
- **Never write the lifecycle columns** — the freeze trigger refuses even the
  Owner (\`P0403\`); a restore is \`restore_record\`.
- **Do not filter the Trash on the client** — the server already returned
  exactly the restorable rows; a client filter can only hide something the
  member is allowed to restore.
- **A deleted case's children are listed** and their restore answers
  \`parent_deleted\` — restore the case, not the child.
- **A version is a projection of the parent's policy** — if a screen shows a
  version of a row the viewer cannot read, the bug is upstream, in the read.
- **Cron jobs must stay idempotent** — a job that notifies on every run pages
  people on every cron gap recovery.`,
  },
  {
    slug: "platform-services",
    title: "Platform services",
    section: "Data & API",
    body: `The platform upgrade (migration \`20261105120000_platform_upgrade\`, one PR)
added a services tier the portal does not depend on: evidence integrity and
custody, background jobs with an in-Supabase runner and an optional worker,
server-rendered case packets with manifests, document extraction / tools /
search, crawled external sources, one RLS-scoped graph RPC, three search
tiers, feature flags and system health. This chapter is the developer's map.
The design and the decisions are in [\`docs/PLATFORM-UPGRADE.md\`](../PLATFORM-UPGRADE.md),
the authority rules in [\`docs/AUTHORIZATION.md\` §22](../AUTHORIZATION.md),
the member's view in [\`docs/WORKFLOWS.md\` §16–§18](../WORKFLOWS.md) and
the Portal User Guide (\`/guides/user-guide\`), operations in
[\`docs/OPERATIONS.md\` §11](../OPERATIONS.md).

## 24.1 The one rule, restated

**Nothing here invents an authority, and nothing here runs in the request
path.** Every new table has RLS on with SELECT-only client policies built
from the existing chokepoints (\`perm_registry_visible\`, \`can_read_case\`,
\`case_writable\`, \`is_owner\`, the new \`external_source_visible\` /
\`semantic_chunk_visible\`); every write is a \`security definer\` RPC or the
service role; every long operation is a \`background_jobs\` row whose result
arrives as a notification. The CI rule is not re-implemented anywhere — no
new code joins \`confidential_informants\` or \`ci_*\`, and \`persons\` still has
no CI column. Restricted media, SIU-blocked sections, sealed legal and
restricted intelligence are excluded **server-side before** a document,
packet, index, chunk, graph node or notification is built.

## 24.2 The map

| Area | Server | Client | Tests |
|---|---|---|---|
| Evidence | \`media\` (+22 columns), \`evidence_custody_events\`, \`evidence_*\` RPCs, \`media_protect_integrity\`, \`custody_chain_*\`, bucket \`case-evidence\` | \`cases/tabs/MediaTab.tsx\`, \`cases/tabs/evidence/*\`, \`src/lib/evidence.ts\`, \`hash.ts\`, \`evidenceQueue.ts\` | \`tests/rls/v192a\`, e2e \`evidence\`, \`hash.test\`, \`evidence.test\` |
| Jobs | \`background_jobs\`, \`private.job_enqueue\` / \`jobs_kick\` / \`job_reap\`, \`job_*\` (service), \`background_job_cancel\` / \`_retry\` / \`_stats\`, cron kick + reap | \`src/lib/jobsModel.ts\`, \`services/queues/jobs.ts\`, \`cases/tabs/documents/JobsTray.tsx\` | \`v192a\` #11, \`jobsModel.test\` |
| Packets, manifests, bundles | \`case_packets\`, \`export_manifests\`, \`case_packet_*\`, \`manifest_verify\`, \`evidence_bundle_*\`, buckets \`case-packets\` / \`exports\` | \`src/lib/packets.ts\`, \`manifest.ts\`, \`services/pdf\`, \`cases/tabs/documents/{GeneratePacketDialog,CasePacketsSection,VerifyPackageDialog}.tsx\`, \`scripts/verify-bundle.mjs\` | \`v192b\`, e2e \`packets\`, \`packets.test\`, \`manifest.test\` |
| Documents | \`document_pages\`, \`document_extractions\`, \`document_tool_request\`, \`document_extract_*\`, \`document_search\`, bucket \`case-documents\` | \`src/lib/documents.ts\`, \`services/documents\`, \`cases/tabs/DocumentsTab.tsx\` + \`documents/*\` | \`v192b\`, \`documents.test\` |
| External sources | \`external_sources\` / \`_versions\` / \`_links\`, \`crawler_policy\`, \`external_source_*\`, \`crawler_policy_set\`, \`private.url_static_check\`, bucket \`external-source-snapshots\` | \`src/lib/externalSources.ts\`, \`urlPolicy.ts\`, \`services/crawler\`, \`field/ExternalSourcesPanel.tsx\` + dialogs | \`v192c\` #1–#7, e2e \`sources\`, \`urlPolicy.test\`, \`externalSources.test\` |
| Graph | \`graph_expand\` (INVOKER; optional \`graph_path\`) | \`graph/InvestigationGraph.tsx\`, \`graph/GraphCanvas.tsx\`, \`src/lib/graphModel.ts\`, \`network/NetworkView.tsx\`, \`cases/CaseGraphTab.tsx\` | \`v192c\` #8–#9, e2e \`graph\`, \`ci-visibility\`, \`graphModel.test\` |
| Search | \`document_search\`, \`external_source_search\`, \`search_authorize\`, \`semantic_chunks\` + \`semantic_search\`, \`hybrid_search\`, \`search_index_queue\`; functions \`search-query\`, \`semantic-query\` | \`services/search/search-service.ts\`, \`shell/SearchPalette.tsx\` | \`v192c\` #9, \`search-service.test\` |
| Flags, health, telemetry | \`feature_flags\` + \`feature_flag_set\`, \`service_health_events\` + \`system_health\`, cron \`health-probe\` | \`src/lib/flags.ts\`, \`owner/OwnerView.tsx\` (System Health), \`src/lib/errorReport.ts\` + \`services/telemetry\`, \`src/instrumentation.ts\` | \`v192c\` #10, \`flags.test\`, \`scrub.test\` |
| Runner and worker | \`supabase/functions/jobs-runner\`, \`_shared/*\` | \`workers/\` (BullMQ), \`docker-compose.yml\` | \`workers/test\`, the three-copy identity in \`urlPolicy.test\` |
| Offline contract | — | \`src/mocks/handlers/platform.ts\`, \`src/mocks/fixtures/rows.ts\` builders for the fourteen tables | \`tests/msw/*\` |

## 24.3 Jobs — how work moves

\`\`\`
request RPC ──► private.job_enqueue(queue, kind, key, args, case, subject)   -- idempotent on (kind, key)
                    │ insert … on conflict do update; perform private.jobs_kick()
                    ▼
      pg_net POST /functions/v1/jobs-runner  (x-jobs-secret = app_secrets.JOBS_SECRET)   + cron every 2 min
                    ▼
      jobs-runner: job_claim(worker, queues, kinds, 5) → for update skip locked, lease 5 min, attempts+1
                    │ run (50 s budget) → job_heartbeat(progress) … → job_complete(result) | job_fail(error, retryable)
                    │        retry: run_after = now() + least(1 h, 5 s · 2^attempts) while attempts < max_attempts
                    │        else: failed + private.job_failed_notify → background_job_failed (Owner)
                    ▼
      *_result RPC (service role) writes the outcome, appends custody, notifies the requester with ids + a deep link
      cron every 5 min: private.job_reap() — a lapsed lease goes back to queued
\`\`\`

The worker (\`workers/src/index.ts\`) does exactly the same through the same
four RPCs; when \`REDIS_URL\` is set the claimed row is mirrored into a BullMQ
queue for concurrency / rate limiting — Redis holds nothing durable. The
runner never claims a kind it cannot run, so a worker-only job simply waits
(visible as \`oldest_queued_seconds\` in \`system_health()\`).

**Adding a job kind.** (1) Add the kind + queue to the \`background_jobs\`
CHECK and to \`src/lib/jobsModel.ts\` \`JOB_KINDS\`; (2) a request RPC that
validates authority with the existing chokepoints and calls
\`private.job_enqueue\` with **ids only** in \`args\`; (3) the processor in
\`supabase/functions/_shared/jobCore.ts\` (copied byte-for-byte to
\`workers/src/jobCore.ts\`) or, for a provider-backed kind, in
\`workers/src/jobs/\`; (4) a \`*_result\` service RPC that writes the outcome
under the service GUC and notifies through \`private.action_notify\`; (5) the
notification kind in \`src/lib/notificationTitles.json\` + \`sync:notif-titles\`;
(6) the mock in \`src/mocks/handlers/platform.ts\`; (7) an allow + deny test.

## 24.4 Evidence — the columns the client may never write

\`sha256\`, \`byte_size\` (after registration), \`mime\` (after registration),
\`evidence_number\`, \`integrity_status\`, \`last_integrity_check\`,
\`current_custodian\`, \`parent_media_id\`, \`derivative_type\`,
\`derivative_service\`, \`derivative_service_version\`, \`parent_sha256\`,
\`sealed_at\`, \`sealed_by\` — \`private.media_protect_integrity()\` raises P0403
unless \`current_setting('cid.evidence_service', true) = 'on'\`, which only the
definer RPCs set. The descriptive family (\`classification\`, \`source\`,
\`collected_by\`, \`collected_at\`, \`location_collected\`) edits under \`media_upd\`.
The custody ledger: \`private.custody_event(media, type, reason, prev, next,
job, export, meta)\` is the one writer; \`custody_chain_stamp\` computes
\`event_hash = sha256(prev_hash ‖ custody_canonical(NEW))\` under an advisory
lock; \`custody_chain_block\` refuses UPDATE / DELETE / TRUNCATE for every role.
Derivatives are new \`media\` rows via \`evidence_derivative_register\` (service)
— never an overwrite. The bucket path is the contract:
\`case/<case_id>/<media_id>/<file>\`; \`evidence_register\` refuses any other
shape and any row without a \`storage_path\` (\`bad_state\`).

## 24.5 Packets — the snapshot is the security boundary

\`case_packet_request\` does not render; it **snapshots**.
\`private.case_packet_snapshot(case, sections)\` runs under the caller and
collects labels, numbers, text, evidence numbers, sha256 hex and the storage
paths of *included* media, using \`perm_registry_visible\`,
\`has_restricted_packet_approval\`, \`siu_blocked\` and \`can_view_legal_request\`
— it has no CI arm and cannot grow one. Whatever the renderer prints later
comes from that JSON, so the renderer (service role) never decides
visibility. \`excluded: {restricted_media, sealed_legal}\` is stored so the
cover can say what was left out. The manifest shape is fixed
(\`manifest_version: 1\`, \`files[{path, size, sha256, source}]\`,
\`source_evidence_ids\`) and \`manifest_sha256\` is the hash of the canonical
text the runner wrote to \`manifest.json\`, so \`manifest_verify\` and
\`scripts/verify-bundle.mjs\` agree byte for byte.

## 24.6 External sources — the URL policy lives in four places

\`private.url_static_check(p_url)\` in Postgres, and three **byte-identical**
TypeScript copies: \`supabase/functions/_shared/urlPolicy.ts\` (the runner),
\`src/lib/urlPolicy.ts\` (the client's pre-check and the vitest suite),
\`workers/src/urlPolicy.ts\` (the worker). Edit the \`_shared\` copy and copy it
to the other two — \`src/lib/urlPolicy.test.ts\` fails when they drift and pins
every blocked class (scheme, userinfo, length, local / internal names, every
private / loopback / link-local / CGNAT / metadata range in v4 and v6 and
their mapped / compatible / NAT64 / 6to4 disguises, the crawler block / allow
lists). The static check is necessary, not sufficient: the fetch provider
resolves DNS and re-checks **every** address of **every** redirect hop with
\`isBlockedAddress\`, caps bytes and time from \`crawler_policy\`, and the
browser never fetches a submitted page.

## 24.7 Graph — one INVOKER function, no client joins

\`graph_expand(kind, id, depth, kinds, limit)\` is \`plpgsql STABLE SECURITY
INVOKER\` with \`search_path = public, extensions\`: it guards
\`private.is_active()\`, clamps depth to 1–3 and limit to 500, filters every
node with \`private.perm_registry_visible(kind, id)\` and every edge with its
link kind's visibility, and reads cases through \`private.can_read_case\`.
Row 0 is the root. It never joins a CI table and has no \`ci\` node kind. The
client (\`InvestigationGraph\`, Cytoscape + fcose behind \`next/dynamic\`) only
draws; expansion is another \`graph_expand\` call rooted at the node; the
shortest path is a client BFS over the loaded subgraph
(\`src/lib/graphModel.ts\`). Adding a node or edge kind means adding an arm to
the function **through an existing chokepoint** — and a line to
\`tests/rls/v192c\` #9 proving the CI stays invisible.

## 24.8 Search — candidates outside, authority inside

Exact search is INVOKER SQL over \`document_pages.tsv\`,
\`external_source_versions.tsv\` and \`search_all\`. The index tier
(Meilisearch, flag \`meilisearch\`) is **candidate-only**: \`search.sync\` builds
documents from readable registry rows (never restricted / SIU-blocked media,
sealed legal or CI anything), the \`search-query\` function fetches
candidates with the server-side key and then calls \`search_authorize(hits)\`
**under the caller's JWT**, which keeps only hits whose row passes an
RLS-scoped select and drops any kind it does not index. The semantic tier
(pgvector, flag \`semantic_search\`) never leaves Postgres: \`semantic_chunks\`
read through \`private.semantic_chunk_visible\`; the \`semantic-query\` function
embeds the query with the server-side key and calls \`hybrid_search\` as the
caller. Neither function ever uses the service role for a search RPC. The
client adapter (\`src/lib/services/search\`) merges the tiers by
reciprocal-rank fusion and falls back to exact when a flagged tier answers
503 — the palette says "showing exact matches".

## 24.9 Flags and failure isolation

\`feature_flags\` rows (Owner writes through \`feature_flag_set\`, realtime
published) with a per-build override \`NEXT_PUBLIC_ENABLE_<KEY>=on|off\`
(\`src/lib/flags.ts\`: \`useFeatureFlags()\`, \`flagOn(key)\`). Three ship on
(\`advanced_graph\`, \`evidence_sealing\`, \`advanced_editor\` — no external
service); seven ship off. The rule for every flagged surface: **off or
absent means the fallback, never an error** — the table in
[\`PLATFORM-UPGRADE.md\` §13](../PLATFORM-UPGRADE.md) is the contract a
reviewer checks. \`system_health()\` (Owner) reports probes, queue stats, cron
runs and failures; \`service_health_events\` never stores a URL or a
credential.

## 24.10 Mocks and tests

\`src/mocks/handlers/platform.ts\` answers every new RPC from the mock store
with the contract's refusal styles (P0403 raise → PostgREST 400,
\`{ok:false, code}\` returns), enforces the fourteen tables' read walls
(\`visiblePlatformRows\`, chained by \`postgrest.ts\`) and write refusals
(42501), emulates the five buckets' wire shapes and policies, and answers
503 for the two query functions. Fixture builders for every new table live
in \`src/mocks/fixtures/rows.ts\`. The live suites are \`tests/rls/v192a\`
(evidence), \`v192b\` (packets / documents / jobs), \`v192c\` (sources / graph /
search + the CI proof); the E2E specs \`evidence\`, \`packets\`, \`sources\`,
\`graph\`, \`ci-visibility\` are LIVE-gated like the rest.

## 24.11 Reference-only projects and future notes

Loom, Veritio, OES and D-CIP contributed concepts (immutable originals, the
canonical-JSON hash chain, provenance columns, page references), not code.
Coolify is documented as an optional way to host \`docker-compose.yml\`
([\`DEPLOYMENT.md\` §5a](../DEPLOYMENT.md)). OpenHands is a development-only
idea: an agent may be pointed at this repository, never at the live project.
Dify / Langflow (and any future model pipeline) would have to be
**authorization-first** — every candidate re-checked per hit in Postgres
the way \`search_authorize\` does — before it may read a narrative; that note
is the only artefact of their evaluation. OpenFGA was evaluated and rejected
(two authorities, non-transactional tuples, a second copy of the CI rule —
[\`PLATFORM-UPGRADE.md\` §11](../PLATFORM-UPGRADE.md)); the \`openfga\` flag is
seeded false and unused so a future evaluation has a switch.`,
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
\`major_crimes | street_crimes | special_investigations | JTF\` (the
2026-08-25 restructure renamed the enum values in place — LSB→\`major_crimes\`,
BCB→\`street_crimes\`; ex-SAB rows were redistributed). \`major_crimes\` (Major
Crimes Bureau, MCB) and \`street_crimes\` (Street Crimes Bureau, SCB) are the
only permanent homes; \`special_investigations\` (SIB) is reserved for
SIB-authority cases and is never a membership assignment; JTF is a
**temporary joint-case designation** (and the pre-approval profile default),
never a permanent home. One canonical definition: \`src/lib/roles.ts\` (the
client mirror of the server matrix \`private.can_assign_cid_role\`).

**Unified assignment matrix (v1.16)** — who may grant a role (signup
approval, promotion/demotion, transfer role changes all use the same rule):

| Final role | May approve / assign |
|---|---|
| Detective / Senior Detective | Bureau Lead of that bureau, or higher |
| Bureau Lead | Deputy Director, Director, or Owner |
| Deputy Director | Director or Owner |
| Director | Owner |

No self-approval, self-role-change, or self-transfer anywhere. Every
approval-with-changes, promotion, demotion, and transfer records a reason.
\`profiles.role/division/active/is_owner/removed_at\` are frozen against ALL
direct client writes (non-definer trigger) — the audited RPCs are the only
mutation path, and each writes \`role_events\` (+\`reason\`/\`source\`/\`source_id\`).
Department moves are single-step (\`transfer_requests\`,
[Ch. 7](07-api.md)): an authorized initiator — a Bureau Lead for
rank-and-file members when one side of the move is their own bureau, or
Deputy Director+/Owner for anyone — picks a destination and reason and
the move applies immediately; JTF is a valid source and destination. Justice roles (ADA/DA/AG/Judge)
are a separate identity domain and grant no CID assignment authority. (Retired
2026-07-22: justice roles are deactivated and legal-request approval is now Bureau
Lead+ (\`private.is_command()\`) — see [DOJ-INTEGRATION.md](../DOJ-INTEGRATION.md)
Phase-1 banner.)

### SIB — a second investigative authority

The Special Investigations Bureau (built as the Special Investigation Unit —
the SIU→SIB rename changed terminology only, and every internal \`siu_*\`
identifier below is unchanged) is a **separate authority domain**, not another
rank: a member operates as CID (\`profiles.role\` + \`profiles.division\`) *or* as
SIB (\`siu_memberships.siu_role\` — \`special_agent\` / \`senior_special_agent\` /
\`special_agent_in_charge\`, displayed as X-Ray 1). One resolver answers every
SIB question:
\`private.siu_standing()\` server-side, mirrored by \`siuStanding()\` in
\`src/lib/siu.ts\` and surfaced to components as \`useSiu()\` — never an inline
\`user.role === …\` check.

Visibility is deliberately **asymmetric**: SIB reads CID across every bureau
(read only — the superset \`private.can_read_case\` appears in SELECT policies
and nowhere else), while CID gets **nothing** on an SIB case at any rank, in
any surface, with no placeholder to reveal that a record exists.
\`siu_compartmented\` cases are allow-list only, with no exemption for X-1, the
Attorney General or the owner flag. Membership is appointment-only
(\`siu_appoint\` / \`siu_remove\`); there is no request queue anywhere.

**Chain of command (the unit's SOP).** Commissioner's Office → **Director of
CID** → X-Ray 1 → agents. The Director and the Attorney General hold
\`oversight\` standing: personnel authority plus **read** of standard \`siu\`
investigations, targets, intelligence and operations — via the read-only
\`private.siu_case_read()\`, never the write wall \`siu_case_access()\`. They
cannot open, assign, reclassify, author, designate, or delete anything.
\`siu_restricted\` and above stay closed to them, which is what keeps an
investigation *into* the Director, the AG or X-1 possible. On a CID case the
SIB-only intelligence layer remains field-agent only, because the Director is a
plausible subject of an integrity flag.

**Taking and releasing (§14/§15).** SIB command can **assume control** of a
live CID case: one flip of \`cases.case_authority\` takes the case and every
child row out of CID at every rank, with the case number, bureau, lead
detective and all authorship untouched, and \`siu_release_control()\` gives it
back. Going the other way, SIB releases a **single item** with \`siu_share()\` —
to the Division, to one case's members, or to one named officer. The release
carries a snapshot of the text, never a pointer, so it can never widen into the
investigation; CID reads it through \`siu_released_intelligence()\`, which
projects no origin at all.

**Tradecraft (Phase 3).** Sources, undercover legends, financial and
communications intelligence, and integrity reviews all ride the WRITE wall
(\`private.siu_case_access\`), never the read superset — oversight reads the case
file, not the tradecraft. Sources and legends narrow further to the handler and
SIB command (\`private.siu_handler_access\`). Exports go through one logged RPC
that always withholds source identities, legends and intercept content.

**Build-phase gate:** while \`siu_settings.enabled_for_non_owner\` is false,
\`siu_standing()\` resolves to \`owner\` for the Portal Owner and NULL for
everybody else, so SIB does not exist for any other account. Full model:
[AUTHORIZATION.md §4f](../AUTHORIZATION.md).

## Permissions (what may you do?) — three layers

\`\`\`
Layer 1  UI hints        canEdit / canDelete / isCommand   → hides buttons only
Layer 2  RLS policies    private.* helpers on every table  → the real wall
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

**The permission module (Phase 1, \`20261005120000\`)** puts one name on the
three layers. On the server \`permission_catalog\` lists every \`(action, kind)\`
with its rule in prose and the RLS suite that pins it; \`public.my_permissions()\`
answers the viewer's access class (\`owner\` / \`command\` / \`member\` / \`inactive\`
/ \`none\`), role, bureau, SIB standing, expiries and flags in one round trip;
\`public.can_record(action, kind, id)\` answers a per-row question through
\`private.perm_dispatch\`, which routes to the **same** \`private.*\` predicates
the policies use (a case, a registry row, a legal request, a report, a field
submission, an action item, the Trash — one arm per kind). A refusal is
recorded either by returning \`{ok:false, code}\` after \`private.perm_deny\`
(soft delete, the entity layer, report templates) or by raising through
\`private.perm_raise\` — SQLSTATE \`P0403\`, the message unchanged — which
\`src/lib/db.ts\` acknowledges once through \`perm_denied_ack\` (intel, the
Action Center). On the client **everything** imports from
\`@/lib/permissions\`: \`usePermissions()\` (server-first over \`my_permissions()\`,
\`NO_ACCESS\` until it resolves; \`can(action, kind)\` reads the generated matrix
\`src/lib/permissionsMatrix.ts\` — \`npm run gen:permissions\`; \`canRecord()\`
asks the server), \`useCapabilities()\`, \`useSiu()\`, and the pure mirrors in
\`mirrors.ts\` / \`sibMirrors.ts\`, which only hide buttons and are pinned to the
matrix by \`parity.test.ts\`. An ESLint rule refuses a predicate imported from
\`roles.ts\` / \`siu.ts\`. Layer 1 above is therefore no longer \`useAuth()\`'s
\`canEdit / canDelete\` alone — it is the module's answer, and the module's
answer comes from the server first.

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

- RLS on every table; deny-all \`app_secrets\`; owner-only \`audit_log\`.
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
   \`docs/archive/HARDENING.md\`.

## Rules for contributors

Never weaken \`safeUrl\`/\`humanizeError\`/\`csvCell\`; never bypass \`db.ts\`;
never add an external host without updating the CSP *and* thinking about
what it can exfiltrate; treat any SECURITY DEFINER change as a security
review, not a code review.`,
  },
  {
    slug: "confidential-informants",
    title: "Confidential Informants",
    section: "Security & auth",
    body: `The Confidential Informant compartment (migration
\`20261103120000_confidential_informants\`) is the first feature in the portal
whose *absence* is part of its contract: a member who is neither a handler
nor CI command must not be able to tell that it exists. This chapter is the
developer's map. The authority rules are in
[\`docs/AUTHORIZATION.md\` §21](../AUTHORIZATION.md), the member's view in
[\`docs/WORKFLOWS.md\` §15](../WORKFLOWS.md) and
the Portal User Guide (\`/guides/user-guide\`).

## 23.1 The one rule

\`\`\`
canAccessCI(user, ci) = hasFullCIAccess(user) OR isAssignedHandler(user, ci)
\`\`\`

- \`private.has_full_ci_access(p_user)\` — active, unremoved, and (Owner, or
  role ∈ bureau_lead / deputy_director / director, or an active
  **non-oversight** SIB member — \`private.siu_membership_role(uid)\` is not
  null). \`director_oversight\` standing alone is *not* full access.
- \`private.ci_is_active_handler(p_ci, p_user)\` — a \`ci_handlers\` row with
  \`ended_at is null\` for an active profile.
- \`private.can_access_ci(p_ci, p_user)\` — the disjunction; a soft-deleted CI
  only for full access.

Every SELECT policy on the fourteen CI tables and every \`ci_*\` RPC's read and
write gate is this predicate. **There is no second wall.** If you find
yourself writing a new CI predicate, stop — extend the existing one.

The discipline that goes with it: an unauthorized caller gets **nothing**.
\`ci_get\` → \`null\`, \`ci_stats\` → \`null\`, \`ci_person_status\` → \`null\`, the
table RPCs → zero rows, \`ci_context()\` → exactly
\`{full_access:false, is_handler:false}\`. Never a \`{ok:false, code:'denied'}\`
on a read, never a lock, never a count. Writes raise \`P0403\`
(\`private.perm_raise\`) — and an unauthorized write against a real CI and a
write against a random id raise the **same** message, so a refused caller
learns nothing about the row's existence.

## 23.2 Tables

Fourteen tables, all with \`enable row level security\`, **SELECT policies
only** — no client INSERT / UPDATE / DELETE policy or grant (a client write is
\`42501\`). Every write is a \`security definer\` RPC.

| Table | Policy | Notes |
|---|---|---|
| \`confidential_informants\` | \`can_access_ci(id)\` | \`ci_number\` \`'CI-0001'\` from \`private.ci_number_seq\`; \`person_id\` **unique where live**, \`on delete restrict\`; status / motive / reliability / risk vocabularies as CHECKs; soft-delete columns |
| \`ci_handlers\` | \`can_access_ci(ci_id)\` | \`role\` primary / secondary, one live row per role and per user; \`counts_toward_capacity\`; \`ended_*\` |
| \`ci_handler_capacity\` | own row or full | \`limit_override\` 1–30, \`expires_at\`, \`request_id\` — the only stored capacity fact |
| \`ci_capacity_requests\` | requester or full | \`kind\` capacity / assignment; \`current_count\`; \`status\` pending → approved / denied / returned / withdrawn; \`created_ci_id\` |
| \`ci_intelligence\` | \`can_access_ci(ci_id)\` | \`handler_id\`, \`case_id\`, reliability + **corroboration** (separate), sensitivity, follow-up; soft-delete |
| \`ci_intelligence_links\` | through the intel's CI | \`kind\` person / vehicle / gang / place / narcotic / evidence / media |
| \`ci_contacts\` | \`can_access_ci(ci_id)\` | method, summary, \`next_contact_at\`, \`restricted_notes\`; soft-delete |
| \`ci_assessments\` | \`can_access_ci(ci_id)\` | reliability / credibility / access / risk / compromise_likelihood / usefulness |
| \`ci_payments\` | \`can_access_ci(ci_id)\` | recordkeeping; \`approved_by\`; soft-delete |
| \`ci_case_links\` | \`can_access_ci(ci_id)\` | one live link per (ci, case); \`unlinked_*\` |
| \`case_intel_releases\` | \`can_read_case(case_id) and (revoked_at is null or full)\` | **the visible, sanitized record** — title, body, handling; carries **no** CI or intel column |
| \`ci_releases\` | \`can_access_ci(ci_id)\` | the restricted link intel → release |
| \`ci_audit_events\` | through the CI; else full / the actor / the request's requester | the compartment's ledger — **never \`audit_log\`**; immutable (BEFORE UPDATE OR DELETE trigger raises) |
| \`ci_events\` | through the CI; else own \`user_id\` / full | the realtime shadow — \`id, ci_id, user_id, kind, at\` only; in \`supabase_realtime\` |

\`persons\` gets **no column**. The one existing public label
\`persons.classification = 'informant'\` is legacy: it is removed from
\`PERSON_CLASSIFICATIONS\` (no new row can carry it) and kept rendering for the
one existing row until cleaned by hand.

Capacity is **derived**: \`private.ci_capacity(user)\` = 6 unless a live
override; \`private.ci_active_count(user)\` = live handler rows on active,
non-deleted CIs that count. Leaving \`active\` frees capacity — nothing is
written.

## 23.3 RPCs

Thirty-five public functions plus the fixture runner, all
\`security definer set search_path to ''\`, granted to \`authenticated\`, revoked
from \`public\` / \`anon\`. The full table with every authority and refusal is
[AUTHORIZATION §21](../AUTHORIZATION.md); the shape to remember:

- **Reads** — \`ci_context\`, \`ci_list\`, \`ci_get\`, \`ci_stats\`, \`ci_case_intel\`,
  \`ci_case_counts\`, \`ci_search\`, \`ci_person_status\`, \`ci_audit_list\`,
  \`ci_export\`: filtered or null, never a raise.
- **Handler writes** — \`ci_create\` (self as primary, no secondary),
  \`ci_update\` (not bureau / supervising lead), \`ci_contact_log/_update/_delete\`,
  \`ci_assess\`, \`ci_intel_create/_update/_set_corroboration/_links_set/_delete\`,
  \`ci_case_link/_unlink\`, \`ci_payment_record\`, \`ci_capacity_request_submit\`
  (\`capacity\` needs to be a handler), \`_withdraw\`.
- **Full-only writes** (\`P0403\` otherwise) — \`ci_create\` for another
  handler, \`ci_set_status\`, \`ci_handler_set\`, \`ci_handler_remove\`,
  \`ci_capacity_request_decide\`, \`ci_capacity_set\`, \`ci_release\`,
  \`ci_release_revoke\`, \`ci_payment_approve\`, the roster \`ci_export\`.
- **Owner** — \`ci_sweep_run()\` (\`{ok:false, code:'denied'}\` style).
- **Fixture** — \`rls_test_ci_sweep(p_ci)\`.

Validation refusals are jsonb \`{ok:false, code, message}\`. The ones with a
fixed wording (the client shows them verbatim):

| code | message |
|---|---|
| \`unavailable\` | \`This person cannot be designated right now.\` — one wording for a taken, merged, deleted or invisible person, for every caller |
| \`capacity\` (non-full caller) | \`You are at capacity (n / c). Request additional capacity or an assignment.\` |
| \`capacity\` (full caller, no reason) | \`<name> is at capacity (n / c). Confirm the override with a reason.\` |
| \`primary_required\` | \`Assign a new primary handler first\` |
| \`unsanitized\` | \`The text names the source — remove the CI number, name, alias or handler.\` |

**Capacity override.** With \`p_override_reason\`, \`ci_create\` /
\`ci_handler_set\` proceed at capacity, write \`CI_CAPACITY_OVERRIDE\` (the reason
in \`detail\`) to \`ci_audit_events\` and raise the handler's \`limit_override\` to
the new count. An approved **assignment** request does the same with
\`'Approved assignment request <id>'\` as the reason.

**Sanitize / release.** \`ci_release\` (full only) runs
\`private.ci_sanitized(ci, title || body)\` — false when the text contains the
CI number, the person's name or alias, the CI alias (whole, or any token of
four letters or more) or a current or former handler's display name, both
sides normalised to lower-case letters and digits first — then inserts \`case_intel_releases\` (visible) + \`ci_releases\`
(restricted), audits \`CI_INTEL_RELEASED\` and notifies the case lead with
\`case_intel_released {case_id, release_id}\` — a kind that names no CI. The
original intelligence row is untouched. The client's \`sanitizeCheck\` is a
cosmetic preview of the server rule, never the gate.

## 23.4 The leak surfaces

Each of these is a place the portal already shows shared data; each is closed
in SQL, and \`tests/rls/v191c.test.ts\` pins every one.

| Surface | Why it could leak | How it is closed |
|---|---|---|
| \`audit_log\` → \`case_audit_feed\` | any row with \`detail->>'case_id'\` = the case is shown to every case reader | CI RPCs write \`ci_audit_events\` and **never** \`audit_log\`; \`case_audit_feed\` additionally excludes \`entity = 'confidential_informants'\` / \`like 'ci\\_%'\` |
| \`search_all\` | a CI arm would confirm a number | no CI arm; the palette calls \`ci_search\` only for an involved caller; the person is an ordinary hit |
| \`entity_suggest\` / \`entity_crossref\` | an edge person → CI | there is no such edge; \`persons\` has no CI column |
| \`notifications\` | a title or payload could name a source | ids only (\`action_notify\` strips text keys); recipients are handlers / reviewers alone; \`notification_resolve\` labels by \`ci_number\` only when \`can_access_ci\` |
| Discord DMs | the edge function relays notifications | every \`ci_*\` kind is \`"destination": "portal"\` (category \`informants\`) in \`src/lib/notificationTitles.json\`; the edge function returns \`skipped: portal-only\` first; the category is never in the opt-in list |
| Realtime | a shadow row is a fact | \`ci_events\` carries ids only and is read behind \`can_access_ci\`; a handler change moves the row's visibility with it |
| The Trash | a label could be a name | \`trash_list\` labels a CI by number; the child kinds carry an explicit \`can_access_ci(x.ci_id)\` conjunct |
| The case tab | a locked tab is a count of one | the \`ci\` tab exists only when \`ci_case_counts\` > 0 — never rendered with a 0 / null count, never in More… |
| The dossier | a card is a fact | \`PersonCiPanel\` renders nothing on a null \`ci_person_status\` |
| \`record_versions\` | a version row is a fact | not attached to CI tables; the history is \`ci_audit_events\` |

## 23.5 Client map

- \`src/lib/ci.ts\` — the ONE CI module: vocabularies + labels,
  \`CI_DEFAULT_CAPACITY = 6\`, \`capacityLabel(active, capacity)\` →
  \`"2 / 6 Informants"\`, \`useCiContext()\` (module-level store, one
  \`rpc('ci_context')\` per session, refetched on \`useTableVersion('ci_events')\`
  and auth change, any error → \`NO_CI\`), \`ciInvolved(ctx)\`, \`getCiContext()\`
  (non-hook getter for the queue), the typed RPC wrappers, \`ciHref(id, s?)\`.
- \`src/lib/ciModel.ts\` — pure helpers with unit tests (\`isAtCapacity\`,
  \`contactState\`, \`groupHandlers\`, \`sanitizeCheck\`, \`motiveSummary\`).
- \`src/components/informants/**\` — \`InformantsView\` (\`/informants\`; not
  involved → the "Nothing here." surface, no mention of informants),
  \`CiProfile\` (\`?ci=\`, sections via \`?s=\`), \`AddCiWizard\` (the capacity
  warning step with **Assign with authorization**), \`ReassignHandlerDialog\`,
  \`RemoveHandlerDialog\`, \`StatusDialog\`, \`ContactLogDialog\`, \`IntelDialog\`,
  \`AssessmentDialog\`, \`PaymentDialog\`, \`CapacityRequestDialog\`,
  \`AssignmentRequestDialog\`, \`CiRequestsPanel\`, \`SanitizeReleaseDialog\`.
- \`src/components/cases/tabs/CiIntelligenceTab.tsx\` (+ \`useCiCaseCount\`),
  \`cases/sections/CaseReleasedIntel.tsx\` (the \`ReleasedIntelligence\` idiom —
  renders nothing when empty), \`persons/PersonCiPanel.tsx\`.
- Nav: \`PAGE_META.informants\`, \`TAB_LABEL.informants = 'Informants'\`,
  Investigations category; Sidebar / Subtabs / BottomNav render the leaf only
  when \`ciInvolved\`. Visits are never pushed to recents or pins.
- Action Center: \`ci_contact_due\` / \`ci_capacity_request\` / \`ci_intel_followup\`
  sources, fetched only when involved; \`ci_request:\` keys are decisions.

## 23.6 The sweep

\`private.ci_sweep()\` — cron \`ci-contact-sweep\` at \`40 * * * *\` inside
\`job_begin\` / \`job_end\`: active CIs with \`next_contact_at < now()\` and no
\`ci_contact_overdue\` in 24 h → the active handlers; active CIs silent for 30
days → handlers + supervising lead (\`detail: 'silent_30d'\`); \`ci_event('overdue')\`.
Owner re-run: \`ci_sweep_run()\`. See [OPERATIONS.md](../OPERATIONS.md).

## 23.7 Tests

| Suite | Proves |
|---|---|
| \`tests/rls/v191a.test.ts\` | the access model — cases 1–6, 13–21, 30–32, 35 |
| \`tests/rls/v191b.test.ts\` | capacity 6, the two \`capacity\` wordings, request → approve → override — cases 7–12 |
| \`tests/rls/v191c.test.ts\` | the leak surfaces, export, sanitize / release, \`ci_case_counts\` — cases 22–29, 33, 34 |
| \`src/mocks/handlers/ci.ts\` + \`ci.test.ts\` | the offline contract: every RPC over the in-memory store, \`visibleCiRows\` for the fourteen tables, 42501 on every write |
| \`tests/e2e/informants.spec.ts\` | the normal detective sees no nav item and nothing at \`/informants\`; the lead the roster; the handler *My Informants: 1 / 6* |

Fixture hygiene: \`rls_test_cleanup()\` is spliced before the reports anchor —
ahead of the persons purge, because \`person_id\` is \`on delete restrict\`.

## 23.8 Common mistakes

- **Answering "denied" on a read.** A CI read that is not permitted returns
  \`null\` / zero rows. A \`{ok:false}\` on \`ci_get\` tells the caller the row exists.
- **Writing to \`audit_log\`.** It surfaces through \`case_audit_feed\`. Use
  \`private.ci_audit\`.
- **A tab with a lock.** The \`ci\` case tab is present with a count or absent.
- **A second predicate.** New CI surface → \`private.can_access_ci\`. Nothing
  else.
- **Free text in a notification payload.** \`action_notify\` strips it, but do
  not rely on that — pass ids.
- **Confusing \`siu_sources\` with the compartment.** SIB's tradecraft table is
  SIB's own, surfaced on the dossier as codename + status. The CI compartment is
  the department programme; SIB members have full CI access by standing, CID
  command has no access to \`siu_sources\`.`,
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

The opt-in live security suite (\`npm run test:rls\`, see
\`tests/rls/README.md\`) additionally posts each run's **sanitized** results
to the Owner Console's Security & Audit section via a vitest reporter
(\`tests/rls/securityReporter.ts\`, v1.14) — fixture-authenticated,
best-effort, and self-skipping when credentials are absent.

## Shipping

Branch from \`main\` → PR → the Vercel bot posts a preview URL (check your
change there) → merge → production tracks \`main\` (atomic alias flip;
instant rollback available in the Vercel dashboard).

## Creating a new feature (the recipe)

1. **Screen**: create \`src/components/<feature>/<Feature>View.tsx\` —
   start by copying a registry view (VehiclesView is the cleanest
   template) and keep its idioms.
2. **Route**: add the tab to \`lib/nav.ts\` (PAGE_META + a category's tabs +
   TAB_LABEL) and the switch in \`app/(app)/[tab]/page.tsx\`. (A new
   *intelligence tool* registers in \`lib/toolsModel.ts\` +
   \`components/tools/toolRegistry.tsx\` instead of the switch — tool slugs
   redirect into the \`/tools\` workspace.)
3. **Data**: if a new table is needed — additive migration on the live
   project, RLS policies (copy the closest pattern in [Ch. 8](08-database.md)),
   realtime publication, FK indexes, then hand-add to
   \`database.types.ts\`.
4. **Docs**: update the relevant guide module in
   \`src/components/guides/docs/\` and this handbook if contracts
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

The **PR template** (\`.github/PULL_REQUEST_TEMPLATE.md\`) structures every
PR (summary, security/permissions, database changes, verification);
"What every change must include" in \`CONTRIBUTING.md\` is the definition
of done. The short contributor guide is
\`CONTRIBUTING.md\`; the v1.0.0 stabilization audit and readiness scores are
in \`docs/archive/RELEASE-READINESS.md\`.

> **The isolation rule**: all development happens on a branch and is
> verified on its PR preview before merge — production tracks \`main\` and
> deploys immediately. GitHub branch protection is a repository *setting*
> (not verified as configured; see docs/archive/RELEASE-READINESS.md §7) — until enabled,
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
- Deletes: \`uiConfirm\` (or \`deleteRecord\`'s built-in confirm) + Undo;
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
- FK-preservation: when an edit form's picker may not be able to resolve
  the currently-linked row (stale cache/restricted/slow lookup), seed the
  id synchronously under a placeholder label ("(current … — loading…)")
  and upgrade it with one bounded \`in:{id}\` lookup — a failed read keeps
  the placeholder, so saving can't null a link the editor didn't touch.

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
- **Give destructive actions an Undo** (\`deleteRecord\` — the soft delete's
  toast, with the Trash behind it) and a confirm.
- **Test realtime with two browsers** when you touch data flows.

## Never

- Never put the \`service_role\` key anywhere in this repo or bundle.
- Never write sign-off/finalize/role columns directly — RPCs only
  (triggers will reject you anyway; don't fight them).
- Never \`dangerouslySetInnerHTML\`, \`innerHTML\`, or unsanitized hrefs.
- Never auto-retry a mutation.
- Never rename \`Store\` keys or nav slugs casually — they're contracts
  (legacy app, deep links).
- A guide's prose has exactly one copy: its module in
  \`src/components/guides/docs/\`. Never mirror it into the database, and never
  rename a section anchor — links into a guide are permanent.
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
| An Investigative Tools tool (\`src/lib/toolsModel.ts\`) | \`TOOL_TABS\`/\`TOOL_GROUPS\`/\`RECORD_PARAM\`/\`RECORD_TAB_TOOLS\`/\`RECORD_TITLE_SOURCE\` + the component maps in \`components/tools/toolRegistry.tsx\`; keep the slug in \`nav.ts\` (redirect contract) | The workspace, the directory, the redirect shim and the RLS-verified restore all read the model; a \`ToolId\` missing from \`TOOL_LIST_COMPONENT\` breaks the workspace render |
| \`lib/db.ts\` contract | Every view's read try/catch and write \`res.error\` check | Throw-vs-return is assumed app-wide |
| \`useAuth\` shape / capability booleans | ~40 consumers, Gate branches | canEdit/canDelete gate every button |
| An RLS policy or \`private.*\` helper | The matching UI gates, \`useNavBadges.canReviewCase\`, zero-rows checks | UI mirrors must match or users see phantom buttons/badges |
| Sign-off RPCs / routing | \`lib/signoff.ts\` labels, CaseDetail Sign-off tab, \`useNavBadges\`, \`notifText\` types | Vocabulary + mirror + notifications track the server states |
| \`FORM_SCHEMAS\` field keys | Saved \`reports.fields\` JSON (old reports must still render), the seeded \`report_template_versions\` (a schema change is a NEW published version — reports keep the one they pinned), \`reportMarkdown\` / \`reportPdfSpec\` exports, warrant matching | Field keys ARE the storage format |
| A case-satellite FK / cascade | \`CaseDetail\` delete config; \`GangsView\`/\`PlacesView\`/\`PersonsView\` children/setNullRefs | Undo restores exactly what the config lists |
| \`Store\` keys | The legacy vanilla app, \`page.tsx\` deep-link shim, the pre-hydration \`PREF_APPLIER\` | Shared localStorage blob = cross-app contract |
| A status vocabulary (values or labels) | \`lib/status.ts\` domain + its source vocabulary (\`signoff\`/\`forms\`/\`caseCharges\`/…), \`ui/StatusBadge\` call sites, \`lib/status.test.ts\` | The registry is the single presentation source; a value missing from its domain renders a bare fallback chip |
| \`user_prefs\`/\`user_drafts\`/\`user_pins\` shapes | \`lib/savedViews.ts\` parse/serialize, \`lib/userDrafts.ts\` size guard, \`lib/pins.ts\`, \`lib/notifications.ts\` mute prefs, the Action Center drafts lane | Owner-only jsonb with size caps — parsers are tolerant (garbage → empty), so a silently-changed shape loses data, not errors |
| \`OPTIONAL_NOTIF_CATEGORIES\` / notification \`type\` strings | \`lib/notifText.ts\` vocabulary, the bell's mute panel, the \`create_notification\` dedupe (matches on type+payload) | Only allow-listed types are mutable; mandatory streams must never become mutable |
| A saved-view \`config\` shape (per list) | That list's apply/save functions only (\`caseUtils\`, registry filter modules) | \`lib/savedViews\` treats config as opaque — each list owns its own migration/tolerance |
| \`globals.css\` accent remap / \`.nav-collapsed\` | Sidebar collapse logic, \`PREF_APPLIER\`, AppearanceModal | The class/dataset contracts live in three places |
| CSP (\`next.config.ts\`) | PDF export (WASM), Supabase REST+WSS, FiveManage, Discord | The allow-lists are exact |
| A guide's prose (\`src/components/guides/docs/*.ts\`) | Nothing — the module is the only copy | Reading progress keeps working; anchors must not be renamed |
| An environment variable | \`vercel.json\` AND \`.github/workflows/ci.yml\` | Duplicated values must agree; \`NEXT_PUBLIC_\` values need a rebuild |
| A user's role (data, not code) | The audited RPCs only: \`change_member_role\` (rank), the \`*_transfer\` workflow (department), \`assign_member\` (activation) | \`profiles.role/division/active/is_owner/removed_at\` are trigger-frozen against every direct client write |
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
   the audited tables with actor + payload. Great for "who changed this?".
   On the relationship-link tables the \`detail\` column also snapshots the
   old/new row jsonb (\`private.audit_detail()\`), so "what did the link say
   before the edit?" is answerable too.
5. **Vercel deployment logs** — build failures only (no runtime server).

## Common bugs and their usual causes

| Symptom | Likely cause | Check |
|---|---|---|
| Button click "does nothing" | A mutation's \`{error}\` is being discarded, or RLS blocked an UPDATE (zero rows, no error) | Network tab for the PATCH; does the caller check \`res.error\` AND empty \`data\`? (\`RecordsView.save\` is the reference pattern) |
| Screen never updates until reload | Table missing from the realtime publication, or the view lacks \`useTableVersion\` in its effect deps | [Ch. 8.6](08-database.md); grep the view for \`useTableVersion\` |
| A screen shows nothing but no error | RLS scope — you're signed in as the wrong bureau/role, or the profile is inactive | Try a command account; check \`profiles.active\` |
| "Could not load: …" notice | The read threw (network, or RLS on a *joined* table) | Network tab; reads are allowed to fail loudly by design |
| New tab/screen 404s or redirects to /command | The nav three-way contract is incomplete | PAGE_META + category tabs + TAB_LABEL + the \`[tab]\` switch (an intelligence tool instead registers in \`toolsModel.ts\` + \`tools/toolRegistry\` — the \`[tab]\` route only redirects tool slugs to \`/tools\`) |
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
Realtime events are debounced per table (~300 ms, leading+trailing), so a
bulk write triggers one refresh instead of one per row.

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
    body: `Recommendations from the July 2026 review; rows marked **done** have since
shipped. Effort: S < 1d, M = days, L = week+.

## Quick wins (S)

| Idea | Why / benefit | Risk |
|---|---|---|
| ~~Drop unused deps (\`react-hook-form\`, \`@tanstack/react-query\`)~~ **done** — dropped; zod kept and adopted (\`src/lib/schemas.ts\`) | Zero imports; smaller install/audit surface | none |
| Drop/verify \`bootstrap_*\` RPCs | Close a setup-era privileged path | none (verify first) |
| ~~Wire or delete \`lib/drafts.ts\`~~ **done** — wired into the report/chat/legal editors; **superseded 2026-08-25** by the DB-backed \`lib/userDrafts.ts\` (\`user_drafts\`, cross-device, per-user local mirror) — \`drafts.ts\` survives as its mirror primitive + the legal stash | Never-lose-work code | none |
| ~~Script + CI check for \`guideContent.ts\` generation~~ **superseded** — the dual-copy system is gone; a guide's prose is its module and nothing else | Killed the drift class at the source | none |
| ~~Fix the guide's hardcoded case-tab illustration~~ **done** — rewritten from the real \`caseTabs.ts\` registry in the September 2026 guide audit | Was drifting from the real tabs | none |
| Fold \`chargeByCode\` into \`penalByCode\`; migrate off deprecated \`roles.isCommand\` | Naming hygiene | trivial |


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
| ~~**RLS/RPC test suite**~~ **done** — the live \`tests/rls/\` suite | Highest-value testing investment | low |
| Server-side pagination/filtering for cases & audit (from DEFERRED.md) | Removes the whole-table-refetch ceiling | medium — touches the refresh idiom |
| ~~Component/E2E smoke tests~~ **done** — \`tests/e2e/\` (smoke + per-domain specs) | Catches integration regressions CI can't | low |

## By theme

- **Technical debt**: schema-in-repo, CaseDetail split, unused deps,
  drafts.ts, registry-hook extraction.
- **Performance**: pagination (when data grows), scanner bounds.
- **Security**: RLS tests, bootstrap RPC removal, nonce CSP, dashboard
  checklist completion (\`docs/archive/HARDENING.md\`).
- **DX**: guide generation script, JSON typing, more unit tests around
  pure domain logic (penal totals, matchKey).
- **UX/A11y**: heat-tint labels, keyboard board moves; ~~notification
  mute preferences, mark-all in the bell~~ **done 2026-08-25**
  (\`lib/notifications.ts\` — optional-stream mutes + one-update mark-all).
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
| **Route / Page** | A URL the app responds to. One dynamic route (\`[tab]\`) serves every screen. |
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
| **Bureau** | A sub-division (\`major_crimes\`/\`street_crimes\`/\`special_investigations\`/\`JTF\`); most case access is scoped to it. \`major_crimes\` and \`street_crimes\` are the permanent homes; \`special_investigations\` marks SIB-authority cases. |
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

Bureaus: \`major_crimes\` (MCB) · \`street_crimes\` (SCB) · \`special_investigations\` (SIB, appointment-only) · \`JTF\` (temporary joint designation). Sign-off chain:
bureau_lead → deputy_director → director.

## The db.ts contract

| Helper | Errors |
|---|---|
| \`list\`, \`custodyForCase\` | **throw** — wrap in try/catch |
| \`insert/update/updateWhere/updateNoSelect/remove/rpc\` | **return \`{error}\`** — check it; empty-data update = blocked |
| \`withRetry\` | reads only |
| \`deleteRecord(table, rows, opts)\` | confirm (+ reason for the parent kinds) → \`soft_delete\` → the "deleted · In Trash" toast; Undo = \`restore_record\`, works from \`/trash\` later too |

## Main RPCs

\`search_all\` · \`signoff_submit/decide/owner_action\` · \`report_finalize\` ·
\`assign_member\` (activation) · \`change_member_role\` · \`request_transfer\`
+ \`approve/reject/cancel/complete_transfer\` ·
\`admin_member_emails/remove/restore\` ·
\`create_notification\` · \`mo_crossref\` ([Ch. 7](07-api.md)).

## Database tables, by RLS pattern

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
- **Own-row**: notifications, watchlist, shift_reports, feedback, profiles;
  personalization (owner-only, no audit, no realtime): user_pins,
  user_drafts, user_prefs
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
\`casesScope\` · \`casesView\` · \`caseFilters\` · \`benchType\` · \`watchSeen\` ·
\`recentSearches\` · \`recentRecords\` (ids-only recents trail, \`lib/recents\`) ·
\`caseSeen:<caseId>\` · graph saved views (\`lib/savedViews\`, key from \`graphViewKey(root)\`) · per-registry view/sort/filter
keys (\`personFilters\`, \`personsView\`, \`personsSort\`, \`narcoticsView\`,
\`narcoticsFilters\`, \`sopsShelfView\`, \`sopsShelfSort\`).

Retired keys still honored for migration/legacy: \`caseViews\` (lifted into
\`user_prefs\` \`views:cases\` on first load — \`lib/savedViews\`); \`pinnedCases\` /
\`recentCases\` (superseded by \`user_pins\` / \`recentRecords\` — the legacy site
still writes them, this app no longer reads them). Cross-device per-user
state lives in \`user_pins\`/\`user_drafts\`/\`user_prefs\`, not here.`,
  },
  {
    slug: "faq",
    title: "FAQ",
    section: "Reference",
    body: `**Where should I add a new page/screen?**
Four places, all required: (1) \`src/components/<feature>/<Feature>View.tsx\`
(copy \`VehiclesView\` as a template); (2) \`src/lib/nav.ts\` — a \`PAGE_META\`
entry, the slug in a category's \`tabs\`, a \`TAB_LABEL\`; (3) the switch in
\`src/app/(app)/[tab]/page.tsx\`; (4) the Portal User Guide module,
\`src/components/guides/docs/userGuideDoc.ts\`. Miss (2) or (3) and the tab
redirects or renders a
placeholder. Full recipe: [Ch. 14](14-development-workflow.md).
An *intelligence tool* is the one exception: keep its slug in
\`PAGE_META\`/\`TAB_LABEL\`, then register it in \`src/lib/toolsModel.ts\` and
\`src/components/tools/toolRegistry.tsx\` instead of the \`[tab]\` switch —
the route only redirects tool slugs into the \`/tools\` workspace.

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
Modals guard dirty state automatically. For persistence use
\`lib/userDrafts.ts\` — DB-backed (\`user_drafts\`, owner-only RLS,
cross-device) with a per-user localStorage mirror and the \`ui/SaveState\`
chip; \`lib/drafts.ts\` remains only as its local-mirror primitive (and the
legal wizard's deliberate device-local stash). Per-user *preferences* go in
\`user_prefs\` (\`lib/savedViews.ts\` shows the pattern) when they should follow
the member across devices, or the \`Store\` blob when they're genuinely
device-local. Per-user record bookmarks are \`user_pins\` (\`lib/pins.ts\`).
Don't invent another mechanism.

**How do I test realtime behavior?**
Two browsers (or one normal + one incognito) signed in as different
users; change data in one, watch the other. Preview deployments work too.

**Who can delete things?**
Nobody destroys anything from a browser: a delete is \`soft_delete\`
(command for registries and cases, the author for their own task / note /
blocker / message — RLS \`perm_registry_delete\`), always with Undo and the
Trash behind it. The server cascades a parent's exclusive children under
one \`delete_batch\` and \`restore_record\` brings the batch back; if a child
seems missing after a restore, look at the migration's cascade list, not at
the client. Permanent deletion is the Owner's armed protocol
([Ch. 22](22-versions-trash.md)).`,
  },
]
