# Chapter 3 — Architecture Blocks

[← Handbook index](README.md)

The codebase divides into nine blocks. **Risk** = how likely a careless
change is to break something important. **Common mistakes** are real traps,
not hypotheticals.

## Block 1 — Configuration & Build
`next.config.ts`, `vercel.json`, `tsconfig.json`, `vitest.config.ts`,
`package.json`, `.github/*`, `eslint.config.mjs`
- **Responsibility**: compile, secure (CSP headers), deploy, gate quality.
- **Risk: HIGH.** The CSP is exact: `wasm-unsafe-eval` exists for PDF
  export; `connect-src` allow-lists Supabase/FiveManage/Discord hosts.
- **Common mistakes**: tightening CSP and silently killing PDF export or
  realtime; forgetting `vercel.json` and `ci.yml` duplicate the env values.

## Block 2 — Routing & App Shell
`src/app/*`, `src/components/shell/*`, `src/lib/nav.ts`,
`src/lib/toolsModel.ts`, `src/components/tools/*`
- **Responsibility**: URL ↔ screen; the constant chrome; nav metadata.
- **Data flow**: URL → `[tab]/page.tsx` switch → feature view inside
  `AppShell`; `useNavBadges` computes the Command-button badges.
- **Risk: MEDIUM-HIGH.** `nav.ts` is a three-way contract (PAGE_META keys
  = URL slugs = TAB_LABEL keys) plus the `[tab]` switch.
- **Investigative Tools**: the former Intelligence category's 14 tabs are
  one nav item (`/tools`) in both CID and SIB sidebars. `toolsModel.ts` is
  the data-only model (`TOOL_TABS`, `TOOL_GROUPS`, record deep-link params,
  `RECORD_TAB_TOOLS`, RLS title sources); `components/tools/` renders it —
  directory + keep-alive tab strip (`ToolsView`: open tabs stay mounted,
  inactive `display:none`), the lazy per-tool registry (`toolRegistry`),
  and the `ToolTabRedirect` shim the legacy `/{tool}` routes render (query
  params carried over, so old deep links survive). Open tabs persist in
  sessionStorage per user as **ids only** and restore with titles
  re-fetched through the RLS-scoped client (invisible rows close silently).
- **Common mistakes**: adding a screen to PAGE_META but not the switch
  (renders a placeholder) or not a category (unreachable from the sidebar);
  importing a tool view from the `[tab]` page instead of `toolRegistry`
  (double-ships the chunk and bypasses the workspace).

## Block 3 — Auth & Identity
`src/lib/auth.tsx`, `src/lib/roles.ts`, `src/lib/profiles.ts`,
`src/components/auth/Gate.tsx`
- **Responsibility**: sign-in state machine, `useAuth()` context,
  capability booleans, roster cache.
- **Risk: HIGH.** ~40 files consume `useAuth()`.
- **Common mistakes**: selecting the `email` column as a member (it's
  command-granted — use `PROFILE_COLS`/`updateNoSelect`); using the
  deprecated role-only `isCommand` instead of `meIsCommand`/auth booleans.

## Block 4 — Data Access
`src/lib/db.ts`, `src/lib/supabase.ts`, `src/lib/database.types.ts`
- **Responsibility**: the ONLY sanctioned path to the database.
- **The contract**: `list()` **throws**; mutations **return `{error}`**;
  `updateWhere` returning zero rows with no error = the predicate matched
  nothing (RLS-blocked or lost race) — treat as failure; `withRetry` is
  reads-only; `deleteWithUndo` snapshots cascade children before deleting.
- **Risk: HIGH.** Every feature assumes this contract.
- **Common mistakes**: discarding a mutation's `{error}` (silent no-op —
  historically a real bug class); auto-retrying a mutation.

## Block 5 — Realtime
`src/lib/realtime.ts`
- **Responsibility**: one websocket channel per table (once per session,
  module-level Set), each change bumps a per-table version counter;
  `useTableVersion(table)` re-renders subscribers.
- **Risk: MEDIUM.** A lifecycle bug = stale screens or double channels.
- **Common mistakes**: adding a table but forgetting the realtime
  publication (screen only refreshes on remount); subscribing outside the
  registry.

## Block 6 — Feature Views
`src/components/<feature>/*` (27 folders)
- **Responsibility**: the screens. Uniform shape: fetch on mount + version
  bump → `refresh()`; permission-gated buttons; fresh-mounted modals;
  toasts + Undo for deletes.
- **Risk: varies.** `cases/CaseDetail.tsx` (12 tabs, one file per tab in
  `cases/tabs/` since v1.1.0) is the
  highest-risk file; registry views are the safest and most uniform.
- **Common mistakes**: breaking the deferred-effect pattern ([Ch. 15](15-conventions.md));
  editing a delete's cascade config without checking the FK schema.

## Block 7 — Domain Libraries
`src/lib/{signoff,forms,penal,packet,pdf,docx,search,notify,notifText,watchlist,operations,fivemanage}.ts`
- **Responsibility**: business logic shared across views — sign-off
  vocabulary (read-only interpreter; the chain is SQL!), report schemas,
  penal calculators, the export pipeline, search, notifications.
- **Risk: MEDIUM.** Mostly pure functions.
- **Common mistakes**: renaming a `FORM_SCHEMAS` field key (orphans saved
  report data); making `signoff.ts` *decide* anything.

## Block 8 — UI Primitives
`src/components/ui/*`, `src/lib/{toast,format,markdown,safeUrl,store,drafts}.ts`
- **Responsibility**: widgets and helpers everything is assembled from.
- **Risk: MEDIUM.** `safeUrl` and `markdown.tsx` are XSS surfaces (both
  hard-ruled/tested); `Modal`'s focus/dirty/scroll-lock contract is
  everywhere.
- **Common mistakes**: rendering a DB-sourced URL without `safeUrl`; any
  `dangerouslySetInnerHTML` (one static sanctioned use exists in
  `app/layout.tsx`; never add another).

## Block 9 — The Database (lives in Supabase, not this repo)
RLS on every table, `private.*` helper predicates and trigger functions,
all workflow writes through SECURITY DEFINER RPCs, realtime publication on
most tables (live counts: `npm run check:schema` / the schema snapshot).
- **Risk: HIGHEST.** Deployed bundles and open tabs keep querying the old
  shape — migrations must be **additive only**.
- **Common mistakes**: forgetting to hand-update `database.types.ts`;
  adding a table without RLS policies (it will be invisible, not open);
  writing sign-off/finalize columns directly (triggers reject it).
