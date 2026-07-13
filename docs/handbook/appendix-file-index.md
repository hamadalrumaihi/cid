# Appendix — File & Folder Index

[← Handbook index](README.md)

One line per important file. Risk tags: ⚠ = understand before editing.

## Folders

| Folder | Purpose |
|---|---|
| `.github/` | CI workflow + Dependabot |
| `docs/` | This handbook, user guide, hardening status, historical notes |
| `docs/handbook/` | You are here |
| `public/` | Static assets (web manifest) |
| `src/app/` | Routes, HTML skeleton, error pages, global CSS |
| `src/components/<feature>/` | One folder per screen (27) |
| `src/components/shell/` | Navigation chrome |
| `src/components/shared/` | Cross-feature record widgets (v1.14 extractions) |
| `src/components/ui/` | Generic widgets |
| `src/lib/` | ⚠ All shared logic |
| `supabase/` | Backend migrations, edge functions, backend docs |

## `src/lib/`

| File | One-liner |
|---|---|
| `auth.tsx` | ⚠ Sign-in state machine + `useAuth()` context + capability booleans |
| `database.types.ts` | ⚠ Hand-maintained TS mirror of the live schema |
| `db.ts` | ⚠ THE data layer: list/insert/update/remove/rpc/deleteWithUndo/withRetry |
| `docx.ts` | Dependency-free OOXML writer (byte-fragile ZIP) |
| `deadlines.ts` | Shared deadline engine (v1.14) — feeds `ui/DeadlineChip`; `justice.ts` delegates to it |
| `drafts.ts` | Never-lose-work localStorage stash — reports, chat, and (v1.14) the legal create/edit forms |
| `fivemanage.ts` | Media upload (multipart → hosted URL) |
| `format.ts` | timeAgo/todayISO/fmtUSD/slug/downloadBlob/copyText |
| `forms.ts` | 8 report schemas + warrant helpers + finalize-gap check |
| `markdown.tsx` | Safe mini-Markdown → React (no innerHTML, ever) |
| `nav.ts` | ⚠ PAGE_META / categories / labels — the nav contract |
| `notify.ts` / `notifText.ts` | Notification write (RPC, unforgeable) / render vocabulary |
| `operations.ts` | Operations zustand cache + status colors |
| `packet.ts` / `pdf.tsx` | Case-packet gathering / court-styled PDF renderer (dynamic import) |
| `penal.ts` | Static penal code (162 charges) + calculators |
| `profiles.ts` | Roster cache + `officerName()` |
| `realtime.ts` | ⚠ One channel per table → version counters (`useTableVersion`) |
| `roles.ts` | Role/bureau vocabulary + seniority + command predicates |
| `safeUrl.ts` | ⚠ XSS scheme allow-list for DB-sourced URLs (tested) |
| `schemas.ts` | Zod tolerant parsers for structured JSON payloads (v1.14) — legal form_data, packet manifests, notification payloads, report signatures/reopen logs, security overview |
| `search.ts` | `search_all` RPC wrapper + penal hits + recents |
| `signoff.ts` | Read-only sign-off vocabulary/tints/"whose court" hint |
| `store.ts` | The shared localStorage blob (legacy-compatible keys) |
| `supabase.ts` | ⚠ Lazy client singleton + `isConfigured` |
| `toast.ts` | Toast store + `humanizeError` |
| `watchlist.ts` | Follow-store + seen stamps |

## `src/app/` & `src/components/shell|ui/`

| File | One-liner |
|---|---|
| `app/layout.tsx` | Root HTML, fonts, pre-hydration theme applier (the one sanctioned innerHTML) |
| `app/page.tsx` | ⚠ `/` redirect shim + OAuth-callback wait |
| `app/(app)/layout.tsx` | AuthProvider → Gate/AppShell boundary |
| `app/(app)/[tab]/page.tsx` | ⚠ The 29-way switch |
| `app/globals.css` | ⚠ Theme tokens, accent remap, collapse contract, editor styles |
| `app/error/global-error/not-found.tsx` | Crash and 404 screens |
| `shell/AppShell.tsx` | Chrome composition + tab persistence |
| `shell/Header.tsx` | Title bar, `/` & ⌘K shortcuts, LOA, sign-out |
| `shell/Sidebar.tsx` | ⚠ Categories, badges, body-class collapse |
| `shell/BottomNav.tsx` / `Subtabs.tsx` | Mobile bar / in-category tab strip |
| `shell/SearchPalette.tsx` | ⚠ ⌘K search + quick actions |
| `shell/NotificationsBell.tsx` | Live bell + mark-read |
| `shell/useNav.ts` / `useNavBadges.ts` | Routing helpers / ⚠ badge logic mirroring server rules |
| `shell/ConnBanner` / `AppearanceModal` / `MyProfileModal` / `icons` | Offline pill / accent+density / self-profile / SVG icons |
| `ui/Modal.tsx` | ⚠ Focus trap, dirty guard, scroll-lock, ref-routed handlers |
| `ui/dialog.tsx` | uiConfirm/uiPrompt + host |
| `ui/DataTable.tsx` | Sort/filter/CSV table (+ injection-guarded `csvCell`) |
| `ui/RichEditor.tsx` | Tiptap markdown editor |
| `ui/Toaster.tsx` | Toast renderer |
| `ui/WorkflowTimeline.tsx` / `ui/DeadlineChip.tsx` | v1.14 shared history render / deadline chip (see [Ch. 6](06-components.md)) |
| `shared/RelatedRecordPicker.tsx` / `VersionViewer.tsx` / `SignatureViewer.tsx` | v1.14 cross-feature record picker / version list / signature trail |

## Feature views (main file per folder)

`analytics/AnalyticsView` (charts) · `announce/AnnounceView`+Modal+utils ·
`audit/AuditView` (owner-only) · `auth/Gate` ·
`ballistics/BallisticsView` · `bolo/BoloView` (warrant chips) ·
`calendar/CalendarView` · `casefiles/CaseFilesView` (uploads) ·
`cases/`: ⚠`CasesView`, ⚠`CaseDetail` (12 tabs, one file each in `tabs/`), ⚠`CaseModal`,
`CaseBoard`, `CaseFilterBar`, ⚠`CaseGraphTab`, `TimelineBand`,
`caseUtils`, `StaleBadge`, `WatchButton` ·
`command/`: ⚠`CommandView` + 8 widgets + `commandUtils` ·
`feedback/FeedbackView` · `gangs/`⚠`GangsView` · `guide/GuideView`
(+generated `guideContent.ts`) · `heatmap/`⚠`HeatmapView` ·
`inbox/`⚠`InboxView` · `indicators/IndicatorsView` (matchKey) ·
`media/MediaView` · `modus/ModusView` (crossref) ·
`narcotics/NarcoticsView` · `network/NetworkView` ·
`operations/OperationsView` · `penal/PenalView` ·
`personnel/`: PersonnelView, AdminPanel, ⚠AssignModal, Commendations ·
`persons/`: PersonsView, PersonModal, ⚠IntelProfile, dossier ·
`places/PlacesView` · `records/RecordsView` (zero-rows check) ·
`rico/RicoView` (imports CaseDetail's RicoTab) · `shifts/ShiftsView` ·
`sops/SopsView` (version snapshots) · `vehicles/VehiclesView` (scanner) ·
`ViewPlaceholder`.

## Root config

`next.config.ts` ⚠ (CSP) · `vercel.json` (public build env) ·
`vitest.config.ts` · `tsconfig.json` (`@/` alias) · `eslint.config.mjs` ·
`.env.example` · `SETUP.md` · `package.json`.
