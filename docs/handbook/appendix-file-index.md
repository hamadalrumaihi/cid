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
| `src/components/tools/` | Investigative Tools workspace (`/tools`): directory, tab strip, redirect shim, lazy tool registry |
| `src/components/shared/` | Cross-feature record widgets (v1.14 extractions) |
| `src/components/ui/` | Generic widgets |
| `src/lib/` | ⚠ All shared logic |
| `supabase/` | Backend migrations, edge functions, backend docs |

## `src/lib/`

| File | One-liner |
|---|---|
| `auth.tsx` | ⚠ Sign-in state machine + `useAuth()` context + capability booleans |
| `autofill.ts` | Pure autofill/save-choice invariants — `buildAutofill` never replaces user input; `diffForMasterUpdate` fills only the master's gaps (no overwrites, no blanks); no I/O |
| `database.types.ts` | ⚠ Hand-maintained TS mirror of the live schema |
| `db.ts` | ⚠ THE data layer: list/insert/update/remove/rpc/deleteWithUndo/withRetry |
| `docx.ts` | Dependency-free OOXML writer (byte-fragile ZIP) |
| `deadlines.ts` | Shared deadline engine (v1.14) — feeds `ui/DeadlineChip`; `justice.ts` delegates to it |
| `caseHealth.ts` | Pure, clock-injected advisory health flags (hygiene + due/returned signals) — never fetches, skips flags whose inputs weren't passed; renders via `cases/CaseHealthRow` + the CasesView attention marker/"Needs attention" filter |
| `drafts.ts` | localStorage draft primitive (`cid-draft:` keys) — now mostly `userDrafts`' local mirror; the legal wizard's stash keeps the legacy shared keys |
| `userDrafts.ts` | DB-backed never-lose-work drafts (`user_drafts`, owner-only RLS, cross-device): debounced upsert, per-user local mirror, 60KB guard, offline degradation; feeds `ui/SaveState` |
| `entityPreview.ts` | Lite RLS-scoped record projections + linked-record counts for `ui/RecordPeek` (incl. case/operation/member kinds) |
| `entitySearch.ts` | Shared entity-search registry — bounded per-kind picker loaders (`searchEntities` + typed arms), matching-only normalizers (`normPlate`/`normPhone`/`normHandle`), merged tombstones filtered |
| `fivemanage.ts` | Media upload (multipart → hosted URL) |
| `format.ts` | timeAgo/todayISO/fmtUSD/slug/downloadBlob/copyText |
| `forms.ts` | 8 report schemas + warrant helpers + finalize-gap check |
| `markdown.tsx` | Safe mini-Markdown → React (no innerHTML, ever) |
| `nav.ts` | ⚠ PAGE_META / categories / labels — the nav contract |
| `notify.ts` / `notifText.ts` | Notification write (RPC, unforgeable) / render vocabulary |
| `notifications.ts` | Shared notification actions — mark-read, mark-all (one conditional update), accurate unread count, mute prefs (`user_prefs` key `notif_muted`; only `OPTIONAL_NOTIF_CATEGORIES` are mutable) |
| `operations.ts` | Operations zustand cache + status colors |
| `packet.ts` / `pdf.tsx` | Case-packet gathering / court-styled PDF renderer (dynamic import) |
| `penal.ts` | Static penal code (162 charges) + calculators |
| `pins.ts` | DB-backed pinned records (`user_pins`, owner-only RLS, cross-device, ids only, soft cap 24) — distinct from the Follow watchlist |
| `profiles.ts` | Roster cache + `officerName()` |
| `recents.ts` | Device-local recently-opened trail (Store blob, ids only, pushed on deliberate opens) |
| `savedViews.ts` | Per-user saved views over `user_prefs` (`views:<section>` rows, opaque caller-shaped config, one default per section; one-time migration of the legacy `caseViews` Store key) |
| `realtime.ts` | ⚠ One channel per table → version counters (`useTableVersion`) |
| `roles.ts` | Role/bureau vocabulary + seniority + command predicates |
| `safeUrl.ts` | ⚠ XSS scheme allow-list for DB-sourced URLs (tested) |
| `schemas.ts` | Zod tolerant parsers for structured JSON payloads (v1.14) — legal form_data, packet manifests, notification payloads, report signatures/reopen logs, security overview |
| `search.ts` | `search_all` RPC wrapper (now incl. bolo/task arms) + client-side charge/member/intel-tip hits, kind metadata (`SEARCH_KINDS`) + recent searches |
| `signoff.ts` | Read-only sign-off vocabulary/tints/"whose court" hint |
| `status.ts` | ⚠ Central status registry — label/tint/meaning/who-acts-next for every status vocabulary (composes `tint.ts` + domain vocabularies; disambiguates warrant "Return filed" from legal "Returned for revision"); render via `ui/StatusBadge` |
| `store.ts` | The shared localStorage blob (legacy-compatible keys) |
| `supabase.ts` | ⚠ Lazy client singleton + `isConfigured` |
| `toast.ts` | Toast store + `humanizeError` |
| `toolsModel.ts` | ⚠ Investigative Tools model (data only) — TOOL_TABS/groups, record deep-link params, RLS title sources |
| `watchlist.ts` | Follow-store + seen stamps |

## `src/app/` & `src/components/shell|ui/`

| File | One-liner |
|---|---|
| `app/layout.tsx` | Root HTML, fonts, pre-hydration theme applier (the one sanctioned innerHTML) |
| `app/page.tsx` | ⚠ `/` redirect shim + OAuth-callback wait |
| `app/(app)/layout.tsx` | AuthProvider → Gate/AppShell boundary |
| `app/(app)/[tab]/page.tsx` | ⚠ The per-tab switch (intelligence tool slugs → `ToolTabRedirect` → `/tools`) |
| `app/globals.css` | ⚠ Theme tokens, accent remap, collapse contract, editor styles |
| `app/error/global-error/not-found.tsx` | Crash and 404 screens |
| `shell/AppShell.tsx` | Chrome composition + tab persistence |
| `shell/Header.tsx` | Title bar, `/` & ⌘K shortcuts, LOA, sign-out |
| `shell/Sidebar.tsx` | ⚠ Categories, badges, body-class collapse |
| `shell/BottomNav.tsx` / `Subtabs.tsx` | Mobile bar / in-category tab strip |
| `shell/SearchPalette.tsx` | ⚠ ⌘K search + permission-gated go-to/create commands (full-screen sheet below `lg`) |
| `shell/CreateHost.tsx` | Universal "+ Create" context provider — lazy-loads the exported registry modals; `useCreate().open(kind)` |
| `shell/NotificationsBell.tsx` | Live bell — grouped clusters, accurate unread count, mark-all, mute settings (via `lib/notifications`) |
| `shell/useNav.ts` / `useNavBadges.ts` | Routing helpers / ⚠ badge logic mirroring server rules |
| `shell/ConnBanner` / `AppearanceModal` / `MyProfileModal` / `icons` | Offline pill / accent+density / self-profile / SVG icons |
| `ui/Modal.tsx` | ⚠ Focus trap, dirty guard, scroll-lock, ref-routed handlers |
| `ui/dialog.tsx` | uiConfirm/uiPrompt + host |
| `ui/DataTable.tsx` | Sort/filter/CSV table (+ injection-guarded `csvCell`) |
| `ui/RichEditor.tsx` | Tiptap markdown editor |
| `ui/Toaster.tsx` | Toast renderer |
| `ui/WorkflowTimeline.tsx` / `ui/DeadlineChip.tsx` | v1.14 shared history render / deadline chip (see [Ch. 6](06-components.md)) |
| `ui/StatusBadge.tsx` / `ui/AccessBadge.tsx` | Registry-backed status chip (tooltip: meaning + who acts next) / one chip for the three access vocabularies (SIB visibility, legal classification, SOP classification) |
| `ui/RecordPeek.tsx` / `ui/SaveState.tsx` / `ui/RecordThumb.tsx` | Lazy record-preview card (data from `lib/entityPreview`) / autosave-state chip (fed by `lib/userDrafts`) / unified record avatar (safeUrl image → initials fallback) |
| `shared/RelatedRecordPicker.tsx` / `VersionViewer.tsx` / `SignatureViewer.tsx` | v1.14 cross-feature record picker / version list / signature trail |
| `shared/LinkEditPopover.tsx` / `RecordSearchPicker.tsx` / `DuplicateMatches.tsx` / `PinButton.tsx` / `RecordPeekButton.tsx` | Relationship-link editor (confidence/status/note over the link tables' UPDATE policies) / bounded registry search combobox (loaders from `lib/entitySearch`; opt-in thumbs, disable-with-reason, peeks, create-new, free-text, multi-select) / non-blocking duplicate hints on create modals / pin toggle over `lib/pins` / peek trigger |
| `shared/LinkedPersonPanel.tsx` / `personCompletion.ts` / `useListboxNav.ts` | Case link form "Registry profile" panel with the case-only vs update-profile completion choice / its pure field-split + provenance-line logic / combobox keyboard kernel (aria-activedescendant, disabled-row skipping) |

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
`sops/SopsView` (version snapshots) ·
`tools/`: ⚠`ToolsView` (the Investigative Tools workspace), `ToolTabBar`,
`ToolDirectory`, `ToolTabRedirect`, `toolRegistry`, `useToolCounts` ·
`vehicles/VehiclesView` (scanner) ·
`ViewPlaceholder`.

## Root config

`next.config.ts` ⚠ (CSP) · `vercel.json` (public build env) ·
`vitest.config.ts` · `tsconfig.json` (`@/` alias) · `eslint.config.mjs` ·
`.env.example` · `SETUP.md` · `package.json`.
