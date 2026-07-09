# Chapter 2 — Repository Tour

[← Handbook index](README.md)

```
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
```

## Folder by folder

### `src/app/` — routes and skeleton
Next.js requires this folder: files here map to URLs. `layout.tsx` is the
HTML shell (fonts, the pre-hydration theme applier); `page.tsx` redirects
`/` to the last-visited tab; `(app)/[tab]/page.tsx` is the single route
that renders all 29 screens; `error/global-error/not-found.tsx` are the
crash/404 screens; `globals.css` holds the entire design system.
**Connected to**: everything renders inside it; reads `lib/nav` for valid
tabs. Details: [Ch. 5](05-pages.md).

### `src/components/shell/` — the chrome
The persistent frame around every screen: `Sidebar`, `Header` (global
keyboard shortcuts), `BottomNav` (mobile), `Subtabs`, `SearchPalette`
(⌘K), `NotificationsBell`, `ConnBanner` (offline pill), appearance/profile
modals, and the `useNav`/`useNavBadges` hooks. **Why it exists**: one
navigation implementation instead of 29. Details: [Ch. 6](06-components.md).

### `src/components/ui/` — generic widgets
`Modal` (focus trap + dirty guard), `dialog` (confirm/prompt), `Toaster`,
`DataTable` (sort/filter/CSV), `RichEditor` (Tiptap). Feature-agnostic —
every feature folder builds on these.

### `src/components/<feature>/` — 27 feature folders
One folder per screen (`cases/`, `gangs/`, `heatmap/`, …). Each is
self-contained: fetches its own data, owns its modals. Only the `[tab]`
router imports them. `cases/` (10 files) and `command/` (10 files) are the
big ones. Details: [Ch. 4](04-features.md).

### `src/lib/` — the shared foundation ⭐
25 files defining every contract the features obey: the data layer
(`db.ts`), auth (`auth.tsx`), realtime (`realtime.ts`), navigation model
(`nav.ts`), domain logic (sign-off, forms, penal code, exports, search,
notifications), and utilities (toast, format, safeUrl, markdown, store).
**Read this folder before touching features.** Details: [Ch. 3](03-architecture.md),
[File Index](appendix-file-index.md).

### `supabase/` — the backend's paper trail
`migrations/` (59 SQL files replayed by `supabase db reset`; note that
later changes were applied directly to the live project — the live schema
is the source of truth), `functions/` (the `discord-notify` edge
function), and backend READMEs. Details: [Ch. 8](08-database.md).

### `docs/` — documentation
This handbook (`handbook/`), `USER-GUIDE.md` (canonical text of the in-app
guide — the in-app copy `src/components/guide/guideContent.ts` is
**generated from it**), `HARDENING.md` (security checklist status), plus
historical build-era notes (HANDOFF, ROADMAP, REACT-PARITY, BACKLOG,
DEFERRED — kept for reference).

### `.github/` — quality gates
`workflows/ci.yml` (typecheck → lint → test → build on every push/PR) and
`dependabot.yml` (weekly dependency PRs).

### Root config files
`next.config.ts` carries the **Content-Security-Policy** — load-bearing
(PDF export and Supabase websockets depend on specific directives).
`vercel.json` carries the public build env (previews need it).
`SETUP.md` stands up a new Supabase project. `.env.example` is the local
env template.
