# Changelog — CID Portal

This project follows [Semantic Versioning](https://semver.org) as of
**v1.0.0** (adopted 2026-07-09). Given the app has a single deployed
instance, versions mark *release milestones*: MAJOR for breaking platform
changes, MINOR for feature releases, PATCH for fixes. Each release lists
the merged PRs that compose it.

## [1.8.1] — 2026-07-13

### Changed — saved reports render styled, not as raw text
- Opening a saved report now shows it **styled like the rest of the site**:
  each form section becomes a card with a header, key-value rows, a real
  table for suspect/witness rows, and readable paragraphs for narratives —
  instead of the previous monospace text dump. The **Download .md** button
  is unchanged and still exports the markdown flattening.

### Fixed — report rows can be removed
- Grid sections in the report editor (e.g. *Suspect / Witness Information*)
  gain a per-row **✕ Remove** button next to **Add row** — previously a row,
  once added, could not be deleted.

## [1.8.0] — 2026-07-13

### Added — evidence lookup while writing a report
- The **Evidence / Property** section of the CID Investigative Report gains
  two pickers: **Add from case evidence** and **Add from case attachments**.
  They list **only** items already attached to the case (the Evidence tab's
  `evidence` rows and the case's attachments) and append the chosen item
  (`EV-001 — description` / attachment title) into the existing fields — no
  retyping, no schema change, drafts/finalize untouched. If nothing is
  attached yet, the form says so and points to the Evidence tab.

### Added — person & vehicle profile pages
- **Person profile** (`/persons?person=…`, shareable/back-button friendly):
  identity card (mugshot, name, BOLO/felony badges, status + alias) with
  key-value rows for the fields the app stores (gang, CCW, VCH, felonies,
  BOLO, DOB when present), plus panels for **Warrants** (derived from case
  reports), **Vehicles**, **Properties**, **Linked cases**, **Media**, and
  **Notes**. The Persons card's Profile button now opens this page; the
  quick-look drawer is unchanged where other views use it.
- **Vehicle profile** (`/vehicles?vehicle=…`): details card (model, mono
  plate, color swatch, owner → linked to their person profile, gang chip)
  with **Linked cases** derived from plate mentions in reports plus the
  owner's case links (fail-closed with Retry — never a false "no cases"),
  and **Notes**. Vehicle cards gain a Profile button; the registry, search,
  cross-case scanner and edit modal are unchanged.
- Both pages reuse the shared design-system primitives, stack on mobile,
  respect reduced motion, read via RLS-scoped queries only, and invent no
  fields the database doesn't store.

## [1.7.2] — 2026-07-12

### Phase D3 — Case-detail tab bar & header (visual + a11y)
Polish on the most-used screen — surgical, single-file; the 12 tabs, their
order, `?tab=` deep-links, and every tab/action/workflow are unchanged.
- **Sticky tab bar** below the shell header (`top-[4.5rem]`/`sm:top-[4.75rem]`,
  `z-10`, blurred background) so it stays visible while scrolling long tabs
  (evidence, timeline).
- **Overflow fades** on the tab strip that track the real scroll position
  (left when scrolled, right while more remains); the active tab scrolls into
  view on load and on change (reduced-motion-safe).
- **Accessible tablist** — `role="tablist"/tab/tabpanel"` with stable
  `id`/`aria-controls`/`aria-selected` pairs and **roving tabindex**:
  Left/Right/Home/End move focus, Enter/Space/click activate. Focus movement
  is separate from activation, so the URL isn't churned as focus roams.
  Tab targets are ≥44px on mobile.
- **Record / workflow divider** — one hairline before `reports` groups the
  workflow cluster (reports · tasks · sign-off · chat) without reordering.
- **Sign-off attention marker** — a dot on the Sign-off tab **only** when the
  case is awaiting a decision (`signoff_status` `awaiting_*`), with an
  `sr-only` + `title` "Sign-off requires attention" (never dot-alone).
- **Header chips** tidied via shared `Badge` into identity (case# · bureau) and
  workflow (status · sign-off · stale) groups; same data + tint helpers.

## [1.7.1] — 2026-07-12

### Phase D5 — Developer Handbook reading polish (owner/dev-only, visual)
Long-form readability on the handbook chapters; no content, generation,
gating, or routing changes.
- **Capped reading measure** — the article column is centered at `max-w-3xl`
  (~72ch) so lines stay readable on wide screens; tables and code blocks keep
  their `overflow-x-auto` and scroll within the measure.
- **"On this page" TOC** (`OnThisPage.tsx`) — built from the existing
  `docHeadings()`: a sticky right column at `xl`, a collapsible block above the
  article below `xl` (≥44px summary). h3 indented under h2; clicks reuse the
  existing `goTo` deep-link.
- **Scroll-spy** — one lightweight `IntersectionObserver`, a single active
  heading at a time, resilient when nothing is intersecting (keeps the last),
  reduced-motion-safe, and it **never writes the URL hash while scrolling** —
  the hash changes only on explicit navigation.
- **Hover/focus heading anchors** — a subtle `#` appears on heading hover or
  keyboard focus, with an accessible "Link to section: …" label, for copyable
  deep-links.

## [1.7.0] — 2026-07-12

### Phase D2 — Owner Portal cleanup (visual only)
Readability and consistency pass on the owner console — no schema, workflow,
RPC, permission, routing, or dependency changes; all data, triage logic, and
owner-gating unchanged.
- **Readable type scale + AA contrast** — bumped the pervasive
  `text-[9/10/11px]` labels to `text-xs`, body to `text-sm`, and muted text to
  `slate-400`; genuinely tabular data stays compact.
- **Design-system adoption** — the local `Panel`/`Notice` now compose the
  shared `Card`/`SectionHeader`/`Notice`/`EmptyState`/`ErrorNotice`; status /
  priority / type chips render via `Badge` (keeping the domain-correct
  feedback tint maps); owner inputs use the shared `Field` styles.
- **Grouped desktop navigation** — the flat 11-item rail is grouped under
  Overview / Monitor / Improve / Understand / Operate (same ids + `?s=`
  deep-links), with a left accent bar on the active item. Mobile keeps its
  section `<select>` picker.
- **Overview KPI strip** — a compact 4-card row (Database · Open feedback ·
  Realtime · Last deploy) that deep-links via `?s=`. It **reuses** values the
  Health and Feedback sections already fetch (a tiny `ownerVitals` store) —
  Overview never fetches — and degrades to a graceful "—/not checked yet"
  until those sections have run.
- **Feedback inbox** — the nine filter views become a cleaner segmented
  control; every triage action and RPC preserved.

### Also in this release (developer tooling — no runtime impact)
- Dedicated-test-project harness scaffold (Playwright functional + visual,
  seed/reset, self-skipping CI) — dormant until a test DB + secrets are
  configured; see `docs/TEST-ENVIRONMENT.md`.
- Curated project subagents in `.claude/agents/`.

## [1.6.0] — 2026-07-09

### UI/UX modernization pass (polish, not a rebuild)
Identity, workflows, permissions and data behavior are unchanged — this
release makes the existing design consistent, safer and more accessible.

#### Design system
- New shared primitives in `src/components/ui/`: **Button** (primary /
  secondary / danger / ghost — one danger shade), **Card** (padding scale,
  canonical border), **Badge**, **Field / Input / Select / Textarea** (+
  exported `inputCls`/`labelCls`, replacing 8+ local copies),
  **PageHeader / SectionHeader**, **Breadcrumbs**, and
  **Notice / EmptyState / ErrorNotice** (replacing 23 copy-pasted `Notice`s).
- New `lib/tint.ts` — one `statusTint`/`priorityTint`/`roleTint` home. The
  case-status colors are now a single map shared by the board, the case
  header, the Command drill pill and the guide legend; the Command pill had
  silently drifted (showed *open* as blue where the board shows amber) and is
  realigned. Command Center / Profile / Operations card borders normalized to
  the app-wide `border-white/5`.

#### States & microcopy
- Registry views show **card-grid skeletons** on first load instead of a
  "Loading…" line; empty states explain what to do next (with a
  call-to-action where you can act); ALL-CAPS "terminal" empties retired.
- Load failures now show a humanized message with **Try again** — raw
  database errors no longer reach the screen, and the 7 views that silently
  showed an empty list when a fetch failed now say so.
- Case board toast reads "Case marked Active." instead of `Status -> ACTIVE`.

#### Safety
- The 6 case-tab deletes that fired instantly (assignments, tasks, chat
  messages, intel links, RICO predicate acts, case templates) now confirm
  with specific dialogs that name the item, warn about related records, and
  keep the 6-second **Undo** (task sub-tasks are snapshotted and restored).
- **Closing a case** (quick-status or drag to Closed) asks for confirmation
  and explains how to reopen.

#### Mobile & navigation
- The **notifications bell** is now visible below desktop width (it was
  completely hidden on phones) and a **search button** opens the search
  palette on mobile; header touch targets are 44px.
- **Breadcrumbs** on case and operation detail replace the bare "Back to X"
  links; the sidebar's active item gains a left accent bar.

#### Accessibility
- One real `<h1>` per view via PageHeader; heading outlines fixed.
- Form labels programmatically associated (`htmlFor`/`id`) across ~20 form
  files; modals expose `aria-labelledby`; RichEditor toolbar buttons are
  labelled and the editor shows a visible focus ring.
- Muted informational text bumped `slate-500` → `slate-400` (WCAG AA);
  small card action chips enlarged to ~40px hit areas without layout shift.

## [1.5.0] — 2026-07-09

### Added — Command Center
- A new top-level **`/command-center`** tab: the single home for command
  administration, gated to command roles (Bureau Lead / Deputy Director /
  Director) and the portal owner. The visible gate is UX only — every action
  still flows through the existing SECURITY DEFINER RPCs and RLS
  (`private.is_command()` / `is_owner()`), which remain the real wall.
  Section-nav pattern with `?s=` deep-links (mirrors the Owner Portal):
  - **Overview** — command KPIs (pending approvals, sign-offs awaiting you,
    active officers, on-LOA) that deep-link to the relevant section.
  - **Chain of Command** — org chart from the roster (owners → director →
    deputies → per-bureau leads/seniors/detectives) plus the sign-off chain.
  - **Personnel & Admin** — the AdminPanel + AssignModal member-management
    controls, **moved here** from the Personnel tab.
  - **Approval Queue** — pending member approvals (one-click approve) plus
    sign-offs awaiting your decision, deep-linking to the case sign-off tab.
  - **Promotions & Transfers** — officer search + role/bureau changes, with a
    **role-change history** from the new `role_events` table.
  - **Duty Status** — active / on-duty / LOA counts and per-bureau officer
    lists.
  - **Permissions** — the access matrix (reuses the Owner Portal matrix).
  - **Announcements & Analytics** — embeds the announcement composer and the
    division analytics view.

### Changed
- **Personnel** is now a read-only member-facing directory: member
  administration (approve / manage / promote / transfer / remove) moved to the
  Command Center. Command staff see a link banner; officers keep their own LOA
  toggle and an "edit my profile" shortcut. The existing sign-off, member
  approval, owner-only audit and dashboard/analytics tabs are unchanged.
- Extracted the shared `canReviewCase()` sign-off predicate to
  `command-center/lib/approvals.ts` (used by both the Inbox and the Approval
  Queue).

### Security / Database
- New **`role_events`** history table (actor, target, old/new role/division/
  active), populated only by the `assign_member` RPC; command-readable RLS,
  realtime-published.
- **`assign_member` tightened for Bureau Leads**: a non-owner Bureau Lead may
  only manage members **in their own bureau**, may **not** promote above
  `senior_detective`, may **not** transfer members out of their bureau, and may
  **not** manage other command staff. Deputy Director / Director / Owner scope
  is unchanged (broader). Enforced in the database, not just the UI.

## [1.4.0] — 2026-07-09

### Added — native profile & settings page
- A member-facing **`/profile`** page (standalone leaf tab, all signed-in
  members) reachable from the sidebar officer card, the header name, the
  sidebar Appearance button, and Personnel's "edit my profile". Sections:
  - **Profile** — editable display name, badge number, **avatar** (image URL,
    **FiveManage upload**, or reset-to-provider), and **Discord link** for
    DMs, plus the LOA self-toggle. Saves via `updateNoSelect`; role/bureau/
    activation stay read-only (frozen by `guard_profile`).
  - **Appearance** — accent + density (device-local `localStorage`), applied
    live. Notes the portal is single-dark-theme.
  - **Account & security** — read-only email, sign-in providers, account
    created / last sign-in, User ID, plus **Sign out** and **Sign out
    everywhere** (global scope). No password form (OAuth / magic-link only).
  - **Notifications** — informational: in-app bell always on; Discord DMs
    gated on the linked Discord ID.

### Changed / Removed
- Replaced the `MyProfileModal` and `AppearanceModal` with the new page; all
  four entry points now open `/profile`. Extracted `applyAppearance()` +
  accent/density constants to `src/lib/appearance.ts`. Guide references updated.

## [1.3.1] — 2026-07-09

The "polish" half of the v1.3 phase — accessibility and loading states.

### Added
- **Loading-skeleton primitives** (`src/components/ui/Skeleton.tsx`):
  `Skeleton`, `CardSkeleton`, `CardGridSkeleton` built on the existing
  `.skel` pulse (reduced-motion-safe). First-fetch states now render the
  *shape* of the incoming content instead of a bare "Loading…" line;
  applied to the Indicators and Gangs registries as the pilot.

### Fixed
- **Accessibility — main landmarks.** The screens that render outside the app
  shell (the auth **Gate**, the route **error boundary**, **404**, and the
  init shim) had no `<main>`, so axe flagged `landmark-one-main` and `region`
  (content not in a landmark) on those states. Each now supplies its own
  `<main>`. WCAG 2.1 A/AA scans across the pages are clean; these were the
  remaining best-practice findings.

*(The Lighthouse-budget item from the v1.3 plan is deferred — tracked in
`docs/CTO-REVIEW.md`.)*

## [1.3.0] — 2026-07-09

The "pattern & debt" half of the v1.3 roadmap phase (the accessibility,
skeleton, and Lighthouse-budget items followed separately).

### Added
- **`src/lib/useRegistry.ts`** — the shared skeleton behind every list screen
  (rows/loading/error state, a sign-in-gated `refresh`, and a deferred,
  realtime-version-driven refetch), extracted so a view supplies only its
  query. **Piloted on the Indicators registry**; the hook returns `refresh`
  and `setRows` so filtering/modals/delete stay in the view.

### Changed
- **`GangsView.tsx` split** (693 → 196-line container) into
  `gangShared.tsx` (types/constants/helpers/Notice), `gangModals.tsx`
  (gang/member/turf/attach modals) and `gangCards.tsx` (card + detail +
  member card) — the last remaining monolith. Also migrated to `useRegistry`.
- More jsonb read boundaries routed through `src/lib/jsonShapes.ts`: case
  template checklists (`CaseModal`) and media tags/labels (`MediaView`) now
  use the shared `parseStringArray` / `parseFormValues` instead of
  re-implementing the guard inline.

## [1.2.0] — 2026-07-09

The "close the loop" ops release — the operational leg the CTO review
(`docs/CTO-REVIEW.md`) flagged as weakest. No new member-facing features.

### Added — monitoring & error tracking
- **In-app error tracking.** `src/lib/errorReport.ts` reports uncaught
  exceptions and unhandled rejections to a new `client_errors` table
  (deduplicated, capped 5/session, noise-filtered). Owners see them in
  **Owner Portal → Health → Client errors** and get a bell notification
  (`client_error` type), throttled by a DB trigger to one per 15 minutes.
  Live migration `client_errors_table`; verified end-to-end (member insert,
  owner read, non-owner denied, owner ping fired, cleaned up).
- **Operations runbook** (`docs/RUNBOOK.md`): monitoring signals, incident
  response, backup/restore drill procedure, and disaster-recovery options
  including the recommended baseline-migration squash.

### Added — CI & tests
- **`security-suites` CI job** runs the RLS suite (and, with a browser, the
  E2E smoke) whenever the `RLS_TEST_PASSWORD_*` repository secrets exist;
  self-skips otherwise, so forks stay green.
- **Owner-positive RLS tests** + a fourth `rls-test-owner` account: proves
  the owner's triage-write and audit-read paths *work* (the block that would
  have caught the v1.1.1 `is_owner` grant bug before shipping). 22 RLS tests.
- **`check:schema`** — offline CI check that `schema-snapshot.sql` and
  `database.types.ts` agree on every table/column, both directions.
- **`gen:guide`** — the in-app User Guide is now generated from
  `docs/USER-GUIDE.md` (mirror of `gen:handbook`) with a CI drift check.

### Added — never-lose-work
- Report editors now persist drafts per case/template (and per report when
  editing), restore them on reopen, and clear on save — extending the case
  chat draft behavior to the report forms.

### Fixed
- `SETUP.md` `is_owner` bootstrap now shows the correct recipe (the
  `profiles_guard` trigger makes the flag immutable even for direct SQL; it
  must be disabled around the update).

### Database
- Live migration `client_errors_table`; schema snapshot regenerated (49
  tables, 40 functions, 171 policies); `MIGRATION-HISTORY.md` → 79 entries.

## [1.1.1] — 2026-07-09

The testing investments from the review (suggestions #9 and #10) — and the
live bug the first run caught.

### Fixed
- **`private.is_owner()` was missing its EXECUTE grant**, so every statement
  whose RLS evaluation touched an `is_owner`-based policy failed with
  `permission denied` for *all* authenticated users: member feedback
  submission, the owner's triage writes, and the owner's audit view. Found by
  the new RLS suite on its first run; fixed live (migration
  `grant_execute_is_owner`).

### Added
- **RLS/RPC security-wall suite** (`npm run test:rls`, 17 tests): bureau
  isolation, deny-by-default, sign-off/finalize lockdown triggers, RPC caller
  checks, owner gates, `is_owner` self-grant immunity, the email column
  grant, and anonymous access — running against the live project as three
  dedicated `rls-test-*` accounts (detective LSB / detective BCB / inactive).
  Opt-in via env credentials; teardown via the new `rls_test_cleanup()` RPC
  (callable only by the test accounts, deletes only rows they authored).
- **Playwright E2E smoke** (`npm run test:e2e`): signed-out gate →
  programmatic session (password grant) → shell → create a case through the
  real UI → detail renders → cleanup. Same opt-in credentials.
- Live migrations: `rls_test_cleanup_rpc`, `grant_execute_is_owner`,
  `rls_test_cleanup_case_files_fix`; schema snapshot + migration history
  regenerated (78 live migrations, 38 functions).

## [1.1.0] — 2026-07-09

The remaining "safe now" improvements from the post-release review
(suggestions #4, #6, #7, #8).

### Added
- **Keyboard & screen-reader path for board status moves**: every case card
  on the board now carries a compact status select (edit-capable users), so
  drag-and-drop is no longer the only way to move a case between columns.
- **Heatmap without color reliance**: map dots now print the intensity
  number in their label, the footer legend maps each dot color to its
  numeric range, and dots are keyboard-focusable (Tab + Enter opens the
  area's records).
- `src/lib/jsonShapes.ts` — dependency-free runtime parsers for the loose
  `jsonb` columns (`cases.charges`, `reports.fields`, tags/mentions
  string-arrays). Every read boundary now degrades malformed rows to safe
  fallbacks instead of trusting a cast; unit tests included (17 tests total).

### Changed
- **`CaseDetail.tsx` split into per-tab files** (`cases/tabs/` — 12 tabs +
  shared helpers, 849 lines → ~240 line composer). Pure mechanical
  extraction; `RicoTab` is re-exported for RicoView.
- Owner Portal suggestions now show a **done \<release\>** badge on shipped
  items (8 of 14 marked).

### Documentation
- Historical build-era docs (`HANDOFF`, `PHASE2-HANDOFF`, `ROADMAP`,
  `REACT-PARITY`, `BACKLOG`, `superpowers/`) moved to `docs/archive/` with
  an index README; all inbound references updated; handbook regenerated.

## [1.0.1] — 2026-07-09

Housekeeping + one live bug fix.

### Fixed
- **Feedback triage inbox was fully broken**: the `private.audit()` trigger
  assumed every audited table has an `id` column, so every write to
  `feedback_meta` (primary key `feedback_id`) failed. The trigger now derives
  the entity id tolerantly (live migration `audit_trigger_tolerant_pk`);
  identical audit rows for all id-keyed tables.
- Case chat now **persists unsent drafts** per case (`src/lib/drafts.ts` was
  shipped but never wired): a draft survives navigation/refresh, restores on
  return, and clears on send.

### Removed
- Unused dependencies `react-hook-form`, `zod`, `@tanstack/react-query`
  (never imported; ~2.6 MB of `node_modules`).
- Dead privileged SQL: `public.bootstrap_command` / `public.bootstrap_director`
  (SECURITY DEFINER escalation-by-email helpers; already unexecutable by
  clients, dropped from the live DB — live migration `drop_bootstrap_functions`).
  `SETUP.md` now bootstraps the first Command user with a direct `update`.

### Documentation
- `supabase/schema-snapshot.sql` — generated reference snapshot of the full
  live schema (48 tables, 168 RLS policies, 37 functions, 56 triggers, enums,
  indexes, grants, realtime publication).
- `supabase/MIGRATION-HISTORY.md` — all 75 live migrations mapped to their
  repo files; the 21 live-only ones are now itemized instead of implied.

## [1.0.0] — 2026-07-09

First stable release of the **React platform** (Next.js 16 + Supabase),
declaring the post-cutover application production-ready.

### The platform (cutover + parity)
- Full React/TypeScript rebuild of the vanilla portal — 29 member screens,
  RLS-authoritative Supabase backend, realtime everywhere (#61 cutover and
  the parity waves before it; legacy runtime removed in #105).

### Features since cutover
- Live upload fix for case attachments (#103); audit/completion sweep with
  watchlist, silent-failure hardening and the My Desk Following panel (#104)
- In-app User Guide (#105), mention + heatmap improvements (#106)
- Checklist templates + division calendar (#107)
- Investigation graph (#107), court-styled PDF exports (#108, CSP #109),
  ⌘K command palette (#110), Tiptap rich editor + interactive heatmap (#111)
- Division analytics, indicators registry with deconfliction, zoomable case
  chronology, DataTable engine with CSV export, graph v2 (#112)
- Visual-first User Guide (#113)
- Security/performance hardening: anon RPC lockdown, 68 FK indexes, custom
  error screens, first unit tests, CI, Dependabot (#114)
- Documentation platform: developer handbook (#121), README/docs audit,
  in-app Developer Handbook, **Owner Portal & Control Center** with the
  is_owner role and the feedback triage inbox (#122)

### Database (live migrations, additive)
`case_templates.tasks`, `indicators`, `security_hardening_and_fk_indexes`,
`owner_role_and_feedback_meta`, `grant_is_owner_select` — the live schema
is the source of truth (mirrored in `src/lib/database.types.ts`).

---

# Pre-1.0 development log (vanilla era)

## Link intel directly to a case (2026-06-22)
- New **Intel tab** on the case detail view: link a **person, gang, or place**
  directly to a case as a "person/gang/place of interest", with an optional role
  (Suspect, Witness, Victim, Associate, Location, …). Each linked item lists with
  a `profile →` jump (persons/gangs open the intel slide-over) and an unlink (✕)
  control; a kind/entity/role picker adds new links, excluding anything already
  linked. This complements the *indirect* links that already surface intel on a
  case (`gang_members.case_id`, `media`, `ballistic_footprints`, `places.case_id`)
  with an explicit, first-class attach.
- The links are **bidirectional**: a person/gang linked from a case now also
  appears in that entity's intel-profile **"Linked cases"** rollup.
- Backed by a new **`case_intel_links`** join table (polymorphic
  `kind ∈ {person, gang, place}` + `ref_id`, unique per `(case_id, kind, ref_id)`,
  optional `role`/`note`). RLS mirrors the bureau-isolation model — select / insert
  / delete all gated on `private.can_access_case(case_id)`, so a link is only
  visible and editable to someone who can already work that case; no UPDATE
  (links are immutable — re-target by unlink + relink). A deleted or
  cross-bureau target degrades to "Deleted / no access" rather than erroring.
- Migration `20260622120000_case_intel_links.sql` is **prepped in-repo but NOT yet
  applied to live `cid`** (pending approval, per the repo's migration convention).
  Until it is applied the Intel tab shows a "run migration" banner and stays
  read-only-empty; no existing data or view is affected.

## SheetJS upgrade — 0.18.5 → 0.20.3, off npm CDN (2026-06-20)
- The Excel (`.xlsx`) import/export library now loads the latest SheetJS
  Community Edition (**0.20.3**) from the **official** `cdn.sheetjs.com` instead
  of npm's `xlsx@0.18.5` via jsdelivr. npm's 0.18.5 is the last release the
  SheetJS team published to npm; it is no longer maintained there and carries
  known advisories (**CVE-2023-30533** prototype pollution + a ReDoS). The
  current build is published only on the authoritative SheetJS CDN.
- Drop-in swap: all call sites (`XLSX.utils.book_new`, `book_append_sheet`,
  `aoa_to_sheet`, `json_to_sheet`, `writeFile`, `read`, `sheet_to_csv` in
  `app.js` / `core.js`) are unchanged — the public API is stable across the
  upgrade. The existing offline guard (`if (!window.XLSX)`) still applies.

## Phase 11 — Gap-close patch: numbering, isolation, FiveManage, heatmap, shifts (2026-06-17)
- **§1 Case numbering** — manual, unique, bureau-prefixed `BUREAU-NUMBER` (e.g.
  `SAB-900023`). Auto-gen removed (`nextCaseNumber`). UI validates the pattern,
  **enforces** the prefix matches the case's bureau, **warns** (not blocks) on the
  leading-digit convention (LSB→1 BCB→2 SAB/JTF→9). DB unique index on
  `cases.case_number`; duplicate → clear inline error. Ticket→case wizard now manual.
- **§2 Bureau isolation (RLS)** — cases + casework children (evidence, custody,
  reports, signoff, assignments, raid-comp, M.O., RICO, predicate acts, trackers,
  case_files) are visible only to the case's bureau. **JTF is shared**; only
  command/director cross-cut; owner/lead/grants still apply. **Chat-visibility rule
  changed**: the old "same-department can read case chat" is superseded by full
  bureau isolation (chat already keyed off `can_access_case`, so it tightened with
  it). M.O. cross-bureau secrecy preserved via a `mo_crossref` SECURITY DEFINER RPC
  (returns case number + shared tags only → "flagged elsewhere, request access").
- **§3 FiveManage** — real upload module (`fivemanage.js`, `window.CID_FIVEMANAGE`)
  wired into the Media vault: upload photo/video → FiveManage → store URL+metadata
  in `media` (case/gang/location/person tags, view, delete by RBAC). Graceful guard
  when unconfigured. **Google Drive stub left intact** (separate `case-files` tab).
- **§4 Commander Heatmap** — new tab: case/turf/place/raid concentration by area,
  driven by live data, bureau-scoped (uses RLS-filtered caches). Added `cases.area`.
- **§5 Weekly shift reports** — `shift_reports` table (RLS rollup to bureau
  leadership + command, realtime) + `shifts.js` tab (file weekly report; leads/
  command see their scope).
- **§6 Tailwind** — already precompiled into `styles.css` (no CDN, no warning,
  offline). Added self-contained CSS for the new heatmap tiles + file uploader so
  they don't depend on the precompiled scan; no change to the existing theme.
- Migrations `20260617140000/140100/140200`; security advisor clean (only by-design
  definer RPCs + N/A leaked-password).

## Phase 10 — Case Files → Google Drive integration built (2026-06-17)
Implemented the previously-stubbed Drive feature (design in
`docs/superpowers/specs/2026-06-15-case-files-drive-design.md`):
- `casefiles.js`: lazy-loads Google Identity Services + gapi Picker on first
  attach; OAuth token client scoped to `drive.file` (least privilege); attach via
  the Picker (multi-select) inserts `case_files` rows (`added_by = auth.uid()`);
  files render grouped into per-case folder cards with open links; director/command
  can remove; case-number combobox from `casesCache`; live via realtime
  subscription on `case_files`; search filter.
- `index.html`: `window.CID_GOOGLE` populated with the project's public OAuth web
  client ID, Picker API key, and GCP project number (all referrer/origin-restricted
  and public by design; allowlisted in `.gitleaks.toml`).
- Note: the static site has no build step, so these live in `index.html` directly
  (Vercel env vars are never substituted into the client).

## Phase 9 — Full logic audit & fixes (2026-06-17)
Meticulous audit of all 20 JS files (parse + cross-file scope + a 15-view runtime
smoke test) and the live DB schema. Bugs found and fixed:

- **🔴 Dead "Case Files" nav link.** The `case-files` tab (Google-Drive-per-case
  view) and `#view-case-files` section existed with two nav buttons, but the tab
  was missing from `PAGE_META`, so `navigate()` silently fell back to Command —
  clicking "Case Files" / "Files" opened the dashboard instead. Registered the
  tab + an `onEnterCaseFiles()` hook so the view opens (Drive integration itself
  shipped in Phase 10). *This was the reported "not working".*
- **🟡 Command "Open Cases" KPI count ≠ drill-down.** Card counted `open+active`
  but drilled to `open` only. Added an `open_active` filter token so the card's
  drill matches its count.
- **🟡 Command Persons KPIs stuck at 0 / empty detective filter on first land.**
  `renderKPIs` reads `PERSONS`/`PROFILES` but they were never reloaded/re-rendered
  on entering Command. `onEnterCommand` now reloads both and re-renders;
  `fetchProfiles` now repopulates the detective filter.
- **🟡 Denied case-access requests sent no notification** (deny button missing
  `data-req`, so `notify(undefined,…)`). Fixed.
- **🟢 Tracker code range** widened (`TRK-1000…9999`) to cut collisions.

DB (live project cid, migration `20260617130000_audit_security_hardening.sql`):
- Fixed `case_files.cf_delete` `USING (true)` → `private.can_delete()`.
- Revoked the `set_case_closed_at()` trigger function from the RPC surface.
- Security advisor now clean of actionable items.

Verified clean (no bug): all entity modules, the bureau/division access gate
(`division` stores bureau codes; admins get global access), and all collab inserts
(server-side `auth.uid()`/default columns).

## Phase 8 — Command dashboard cross-filter & drill-down (#17 follow-up)
Completes the part of #17 deferred in Phase 7. Central Command is now a true
supervisor cockpit:

- **Cross-filters:** a filter bar (visible only to `supervisor`, `bureau_lead`,
  `deputy_director`, `command`, `director`) scopes the whole dashboard by
  **bureau, lead detective, status** (incl. *awaiting sign-off* / *ready for DOJ*)
  **and a created-date range**. Every KPI, the bureau-load chart and the new
  drill-down all honour the active filter; a live "N of M cases" counter and a
  Reset control round it out.
- **Drill-down:** KPI cards (Open / Awaiting / Ready-DOJ / Cold) and the
  bureau-load bars are clickable — they set the matching filter and reveal a
  **Matching cases** panel that lists the scoped caseload; clicking a row jumps
  straight to that case file.
- **New KPIs:** **Avg Resolution** (mean open→closed time, backed by a new
  `cases.closed_at` column + trigger) plus seizures split into **money /
  narcotics / weapons** (the latter two derived from evidence type/description).
  Seizure & evidence KPIs re-scope to the filtered caseload when a filter is on.
- **Schema:** `20260617120000_cases_closed_at.sql` adds `cases.closed_at`,
  backfills existing closed cases, and auto-stamps/clears it via a status trigger.

## Phase 7 — Announcements depth, encouragement, KPIs, richer timeline
Continuation of the master prompt (features #15 full spec, #16–18):

- **#15 Announcements (completed):** posts now carry **record links** (cases) and
  **@mentions** of individuals *or* rank groups ("@All Detectives", "@All Officers").
  Posting fires a **platform notification** to the audience (mentioned users get
  a "you were mentioned" reason). Officers can **dismiss** individual
  announcements (client-side hide via `Store`, not a delete; "show N dismissed"
  restores). Clicking an announcement opens a **full-view modal** with body +
  clickable linked records. Schema: `announcements.links` + `.mentions` jsonb.
- **#16 Encouragement widget:** non-intrusive rotating tactical phrase on the
  Central Command dashboard; rotates on load and every 5 min; dismissible for the
  session (returns on reload, per spec).
- **#17 Command KPIs:** added **Awaiting Sign-off** (cases stuck in the chain) and
  **Ready for DOJ** cards to Central Command, alongside the existing open/cold/
  persons/seizure KPIs, bureau load and audit activity feed. (Central Command is
  the command/supervisor dashboard; dedicated cross-filter/drill-down views remain
  a follow-up.)
- **#18 Case timeline (enriched):** the auto-generated timeline now merges
  **tracker logged/authorized**, **sign-off history**, and **chat messages** in
  addition to evidence collection, reports, custody transfers and case-opened.

## Phase 6 — Collaboration, access control & export (master prompt)
Checked each master-prompt feature against the build; #1–7 already shipped in
Phase 5 and were skipped. Added the rest:

- **#8 In-case chat** (`collab.js`, `case_messages`): per-case channel with
  @mentions (→ notification) and record links (case chips open the case).
  Access gated to owner / same department / chain-lead roles / granted officers.
- **#9 Cross-case alert + access control** (`case_access_requests`,
  `case_access_grants`): the M.O. detector shows matches in inaccessible cases as
  a locked "flagged in another active investigation" alert (no detail leak) with
  a Request-access action. Owner/leads approve/deny in the Chat tab; the
  requester is notified and every request/decision is audited.
- **#13 Export/Import**: SheetJS added — the per-module import tool now accepts
  `.xlsx` (and `.xls`) alongside CSV/JSON; the Case Packet exports to **.docx /
  .pdf / .xlsx** via a chooser with an "Exporting… → Ready" flow, and the packet
  now bundles evidence + reports + media + RICO predicates. (PDF *import* is not
  implemented — reliable structured extraction from arbitrary PDFs isn't feasible
  client-side; CSV/XLSX/JSON cover bulk import.)
- **#14 Sidebar officer card**: removed the hardcoded "Det. Oliver Och / 915"
  block; now a live card (name, badge, department, CID rank, avatar, LOA badge,
  duty dot) that opens a My Profile editor (name/badge + self LOA toggle).
- **#15 Announcements**: new nav page + `announcements` table. Bureau Lead and
  above post (audience targeting + pin); all active officers read; unread badge.
- **#10/#12 polish**: `debounce()` util applied to case/person/gang filter
  inputs; tabs already lazy-fetch via onEnter*; fonts already use display=swap.

Schema: `20260616210000_chat_access_announcements.sql` (4 tables, 3 SECURITY
DEFINER helpers, RLS, audit + touch triggers, realtime) — applied live to cid.

Note on #9 secrecy: case rows remain readable platform-wide (dashboards, search,
KPIs depend on it); access grants gate the case *channel* and collaboration
surface. Hard row-level case hiding would require a visibility refactor across
every dashboard/search and is intentionally not flipped here.

## Phase 5 — Case sign-off workflow + LOA (Tom Wood / 934 workflow)
Verified first that none of the 7 requested features existed; all were added.
Also caught and fixed pre-existing split bugs found while wiring this in.

### Bugs fixed (pre-existing, from the monolith→multi-file split)
- **`casefiles.js` was never added to `index.html`** — so `DB()`, `dbReady()`,
  `casesCache`, `openCaseDetail`, and the entire `CIDApp.onAuthed` boot/fetch/
  subscribe routine were undefined. `auth.js` called `CIDApp.onAuthed` with
  nothing defining it: the authed app never loaded its data. Wired the script in.
- **`escapeHTML` used 120× across 9 files but never defined** (only `esc`
  existed). Added `const escapeHTML = esc;` alias in `core.js`. This had been
  breaking ballistics, gangs, persons, places, narcotics, cases, and trackers.

### Added — features (all were missing)
- **(1) LOA flag** — `profiles.loa` + `loa_since`. Self-toggle in the top bar
  (`auth.js`) and on the officer's own Personnel card; admins/Command/Director
  can set it via the Member Administration modal. Shown as an "On LOA" badge on
  roster cards and the admin table. LOA never blocks sign-off; it only steers
  routing.
- **(2) Sign-off submission UI** — new "Sign-Off" tab in Case Detail. Owners
  (Detective/Senior Detective) submit; reviewers Approve / Deny / Request
  changes (with notes). `signoff.js`.
- **(3) Auto-routing with LOA handling** — Detective → Bureau Lead → Deputy
  Director → Director. Skips a rank when its only members are on LOA / inactive,
  prefers the non-LOA officer when several share a rank (same-bureau Bureau Lead
  preferred), and escalates to the next rank when all are out. Director is final.
  Auto-escalation writes a history entry and an explaining notification. (Unit-
  tested across 7 scenarios.)
- **(4) Sign-off notifications** — `signoff_waiting`, `signoff_approved`,
  `signoff_denied`, `signoff_changes`, `signoff_escalated`, `signoff_heads_up`.
  Each carries case number, detective, reason, and `case_id`; the notifications
  panel now renders the reason and is click-through to the case. Deputy approval
  sends the Director a heads-up even when no action is required.
- **(5) Case status tracking** — `cases.signoff_status` (none → awaiting_bureau_
  lead → awaiting_deputy → approved_deputy → [approved_complete | awaiting_
  director → ready_doj], plus changes_requested / denied). Shown on case cards,
  the detail header, the overview, and a live chain-progress strip. Append-only
  `case_signoff_history` log (who/what/when, with notes). Realtime re-render of
  open Case Detail + history.
- **(6) Stop-point option** — after Deputy approval the owner chooses **Mark
  Approved & Complete** or **Escalate to Director**; the Director can still
  approve or send back if escalated.
- **(7) Ownership vs sign-off separation** — ownership stays on
  `cases.lead_detective_id` (owner selector in the case modal, gated to Bureau
  Lead / Deputy Director / Director / Command). Sign-off never changes ownership
  and ownership never auto-escalates; reassignment is explicit only.

### Schema / roles
- `supabase/migrations/20260616200000_case_signoff_loa.sql` — LOA columns,
  `cases` sign-off columns, append-only `case_signoff_history` (+RLS +realtime).
- Per Tom's choice, added dedicated chain roles to `app_role`:
  `senior_detective`, `bureau_lead`, `deputy_director` (non-breaking ADD VALUE;
  legacy `supervisor`→Bureau Lead and `command`→Deputy Director still honored by
  the router). Admin role picker updated with friendly labels.

## Phase 4 — Official SOPs/forms + Director as supreme role
### Added — CID General document library (live `documents` rows, fully editable)
- `supabase/migrations/20260616180000_sop_templates.sql` seeds the org-standard
  paperwork and reference material (idempotent upsert on the `(folder,name)` key):
  - **Forms/**: CID Investigative Report, Raid Seizure Value Distribution &
    Allocation Form, UC Operation Activity Report (blank, reusable templates).
  - **SOP/Training/**: CID Standard Operating Procedure (Titles 1–12) and the
    CID Case Building Playbook.
  - **Case assignment Help??!?/**: CID Case Assignment Procedure (7 steps).
  - **Resources/**: CID Roster (CID + FDU) and Gang Fact Sheet.
  - These are official org documents, not demo case data; they open as editable
    paperwork and export to .docx like any other Drive file.
  - Applied live to the `cid` Supabase project (all 8 documents verified present).

### Changed — Director is now the supreme role, above all ranks
- Per CID SOP Title 2A.1 ("the CID Director is the senior authority within the
  division"), Director gains full administrative authority equal-or-above Command.
- `supabase/migrations/20260616190000_director_supreme.sql`: redefines
  `private.is_command()` to accept `('director','command')`, so every gate that
  used it (the `profiles_command` policy, `assign_member`, the self-escalation
  block) now treats Director as a full administrator. Adds a `bootstrap_director`
  helper. `can_delete()` already included director. Applied live and verified.
- Client (`supabase.js`): added `isAdmin()` (director **or** command);
  `canDelete()` now delegates to it.
- Client (`app.js`): Member Administration panel now shows for Director or
  Command; role dropdown reordered so **director** reads as the top rank.

### Fixed
- Restored the split-shell `app.js` after a `main` merge had re-inlined the old
  monolith on top of the 16 feature files (duplicate init / double routing).

---

## Phase 1 — Backend foundation (this change)
Goal: stand up the Supabase backend that every module will migrate onto, with
real RBAC. No working front-end logic was rewritten in this phase.

### Added
- `supabase/migrations/20260616090000_platform.sql` — full platform schema:
  - **27 tables**: profiles, cases, case_assignments, persons, evidence,
    custody_chain (append-only), gangs, gang_ranks, gang_members, places,
    place_process_steps, narcotics, narcotic_precursors, narcotic_hotspots,
    ballistics_benches, ballistic_footprints, reports (with finalize +
    e-signature columns), trackers, rico_cases, predicate_acts, media,
    documents (server-side CID General docs), tickets, raid_compensations,
    mo_profiles, notifications, audit_log.
  - **Relational spine**: evidence/media/reports/trackers/hotspots/footprints/
    predicate_acts/gang_members all carry a `case_id` FK; predicate_acts link to
    `evidence`; gang_members link to `persons` + `cases`.
  - **RBAC RLS** (verified against Supabase docs):
    - `private` schema security-definer helpers (`is_active`, `role`,
      `can_delete`, `is_command`) with `search_path=''`.
    - Read = **approved members only** (inactive sign-ins see nothing).
    - Create/update = any active member; **delete = Director + Command**.
    - `profiles`: self-view + self-edit, with a guard trigger blocking
      role/active/division self-escalation; Command-only `assign_member` RPC.
    - Append-only `custody_chain` + `audit_log` (insert/select only).
    - Per-user `notifications`.
  - **Triggers**: `updated_at` touch on 18 tables; generic **audit** trigger on
    16 tables → `audit_log`; `handle_new_user` creates an inactive profile on
    OAuth signup; `bootstrap_command(email)` to seat the first admin.
  - **Realtime** publication on all 27 tables.
- `SETUP.md` — full deploy + Google/Discord OAuth + migration + bootstrap + RBAC.

### Verified
- Migration applies cleanly on Postgres 17 (27 tables, 102 policies, 27 realtime,
  16 audit triggers).
- RBAC behavior tested as the `authenticated` role: inactive → 0 reads;
  activated detective → create+read; detective delete → 0 rows (denied);
  Director delete → success; audit_log captured insert+delete.

### Fixed (bugs caught while building)
- `default (select auth.uid())` → `default auth.uid()` (subqueries are not
  allowed in column DEFAULTs; the `(select …)` form is only for RLS perf).
- `private` schema was revoked from `authenticated`, which would break every RLS
  policy (policy expressions run as the caller); now grants USAGE + EXECUTE on
  the helpers to `authenticated`.

## Pending phases (not in this change)
- **Phase 2 — Front-end:** multi-file split (`index.html` + `styles` + feature
  JS modules + `supabase.js`/`auth.js`); **login gate** (Google + Discord),
  logged-out users see only the login screen; migrate every module's data layer
  from `localStorage` to Supabase with realtime; first-class **Evidence** module
  + **Case Detail** view (Overview/Evidence/Reports/Media/Suspects/Gangs/RICO/
    Timeline/Trackers/Chain-of-Custody) + auto timeline; **RBAC-aware** edit
  affordances; **remove all seed data** → empty states + CSV/JSON import;
  notifications panel; analytics from `audit_log`; PDF export; full case-packet
  export. Blocked on: Google + Discord OAuth credentials + authorization to
  resume/apply against the live project.

### Data migration note (localStorage → Supabase)
The current single-file app stores everything under `localStorage` key
`cid-portal-v3` (cases, gangs, places, reports, rico, trackers, media, cidDocs,
caseCounters). Phase 2 ships a one-time importer to load any existing browser
data into the new tables via the UI; nothing is baked into source.

## Phase 2 — Front-end foundation (this change)
Target project corrected to **`cid`** (`jhxuflzmqspidkvjckox`, active); `sahp-rbac` was the wrong project.

### Added / changed
- **Multi-file split** (no build step, still a static SPA):
  - `index.html` — markup only.
  - `styles.css` — the precompiled Tailwind + custom CSS (was inlined) + gate CSS.
  - `app.js` — the existing application logic, moved verbatim (not rewritten).
  - `supabase.js` — Supabase client + thin data layer (`window.CIDDB`): auth
    helpers + generic list/insert/update/remove/subscribe. Guarded if unconfigured.
  - `auth.js` — **login gate**: logged-out users see only the login screen
    (Google + Discord OAuth + email magic link); signed-in-but-unapproved users
    see a pending-approval screen; approved (active profile) users get the app +
    an identity/sign-out chip in the top bar. Drives `body[data-auth]`.
- Front-end config wired to the real `cid` project URL + publishable key.

### Verified (jsdom, offline)
Split loads; gate shows by default with the graceful offline notice; app shell
hidden when logged out; `app.js` still initializes; records nav intact.

### Still pending in Phase 2 (blocked / next)
- **Schema reconciliation**: the `cid` project already has `cid_records` (2 rows)
  + `case_files` (0 rows), which diverge from the Phase-1 platform schema
  (`cases`, `evidence`, …). Need a decision before applying the platform
  migration / migrating module data layers.
- Apply the platform migration (creates `profiles` — required for auth approval
  to actually work) once schema is reconciled.
- Configure Google + Discord providers in the dashboard to test real sign-in.
- Then: per-module localStorage→Supabase data layer, Case Detail + Evidence UI,
  RBAC-aware edit affordances, notifications, analytics, PDF, seed removal.

### Applied to the live `cid` project (this turn)
- Applied `20260616090000_platform.sql` to project `cid` (jhxuflzmqspidkvjckox):
  27 platform tables created with RLS, alongside the pre-existing `cid_records`
  (2 rows) + `case_files` — no collisions, no data loss.
- Ran the Supabase **security advisor**; fixed a real finding: `bootstrap_command`
  (SECURITY DEFINER, no internal guard) was REST-callable by anon/authenticated —
  a self-promotion-to-Command hole. Revoked execute from anon/authenticated/public
  (SQL-editor only). Trimmed `assign_member` from anon (still callable by
  authenticated Command users; internally guarded).
- Remaining advisor notes (not addressed here): `case_files.cf_delete USING(true)`
  is a pre-existing user table (left untouched); leaked-password protection is an
  auth setting irrelevant to our OAuth + magic-link flow.

### To make auth functional (your dashboard steps)
1. Authentication → Providers: enable **Google** + **Discord** (creds + the
   `https://jhxuflzmqspidkvjckox.supabase.co/auth/v1/callback` redirect).
2. Authentication → URL Configuration: set Site URL + Redirect URLs to your Pages URL.
3. Sign in once, then SQL editor: `select public.bootstrap_command('<your-login-email>');`

## Phase 2 — Module migration #1: Case Files (this change)
First module migrated off localStorage onto the live Supabase schema (project `cid`).

### Added
- **Case Files tab** (sidebar + mobile bar) — Supabase-backed, RBAC-aware, realtime.
  - List of cases (cards) from `public.cases`, filter + refresh, empty/“create first” states.
  - Create/Edit case modal (case_number/title/bureau/status/summary) → `CIDDB` insert/update.
  - **Case Detail** view with tabs: Overview, Evidence, Reports, Timeline.
  - **Evidence** module: add evidence per case; **chain-of-custody** append-only transfer log.
  - **Timeline**: merges case-open + evidence collection + report + custody-transfer events.
  - RBAC affordances: create/edit shown to active members (`CIDDB.canEdit`); **delete** only
    for Director/Command (`CIDDB.canDelete`); realtime re-fetch via `CIDDB.subscribe('cases')`.
- `supabase.js`: added `me`/`role()`/`canEdit()`/`canDelete()`; `auth.js` caches the
  profile + calls `CIDApp.onAuthed()` so modules load once a session is approved.

### Verified
- All JS passes `node --check`; jsdom load is clean (no window errors; gate works; Cases
  tab shows its sign-in notice offline).
- **Live schema round-trip via MCP** on project `cid`: inserted case→evidence→custody,
  confirmed FK cascade on delete and that audit triggers fired (audit_log += 3); test rows
  removed (0 leftover).
- Hardened: guarded `history.replaceState` so restricted/file:// contexts can't break routing.

### Next modules (same pattern)
persons/suspects, gangs (+members→persons), places, narcotics/ballistics hotspot+footprint
links, reports (finalize + e-sign + PDF), trackers (server-side + notify), RICO (pull
predicates from evidence), audit-log feed + analytics on Central Command, seed removal +
CSV/JSON import, full case-packet export.

## Phase 2 — Module migration #2: Persons + Gangs (this change)
- Added `gang_turf` table + free-text `gang_members.rank` (migration
  `20260616093000_gang_turf_member_rank.sql`; applied to project `cid`).
- **Persons** (new tab, Supabase): suspects/POI CRUD with gang link, CCW/VCH/
  felony fields (≥8 flag), mugshot, notes; filter + realtime; delete gated to
  Director/Command.
- **Gangs** migrated OFF localStorage onto Supabase: list + record CRUD, and a
  **Gang Detail** with rank-grouped **member** sub-CRUD (members link to a
  Person and a Case), **turf** sub-CRUD, and read-only **linked properties**
  (places whose controlling_gang = this gang). `GANGS` is now a Supabase read
  cache feeding the place/media/RICO gang pickers.
- Fixed RICO references that used the old localStorage gang shape
  (`.members`/`.threat`) → now use `threat_level`.
- Verified: node --check; clean jsdom load (both tabs, proper sign-in notices,
  no errors); live MCP round-trip on `cid` (gang→person→member(person+case)→turf
  insert with full FK chain; cascade-clean delete).

## Phase 2 — Module migration #3: Narcotics (this change)
- **Narcotics** migrated off localStorage onto Supabase (narcotics + precursors +
  hotspots). `DRUGS` is now a normalized read cache; the expandable registry,
  purity-slider→adjusted-value calc, pricing/popularity bars and case-linked
  hotspots are preserved (logic unchanged, data live).
- CRUD: "+ New Narcotic" + per-drug Edit modal (fields + precursor rows + hotspot
  rows with density + case link); children replaced on save; delete gated to
  Director/Command. Empty/sign-in states; realtime; recompute guards zero precursors.
- Places' production-recipe + drug picker read the DRUGS cache (Places remains
  localStorage for now; links by name).
- Verified: node --check; clean jsdom load (sign-in notice, no errors); live MCP
  round-trip on `cid` (narcotic→precursor→hotspot insert; cascade-clean delete).

## Phase 2 — Module migration #4: Criminal Places (this change)
- **Places** migrated off localStorage onto Supabase (`places`). FK links to live
  gangs (controlling_gang_id), cases (case_id), and **narcotics** (narcotic_id).
- Drug-lab locations show an auto production process derived from the linked
  narcotic's precursors/hotspots (cross-referencing the live Narcotics module).
- CRUD with RBAC (create/edit active; delete Director/Command), empty/sign-in
  states, realtime. PLACES is now a Supabase cache; Gang Detail's "linked
  properties" reads live places.
- Verified: node --check; clean jsdom load; live MCP round-trip on `cid`
  (place linked to gang+case+narcotic) with cleanup.

## Phase 2 — Module migration #5: Ballistics (this change)
- **Ballistics** migrated off localStorage onto Supabase: `ballistics_benches`
  (street/organized toggle, tier, heat, outputs[]/components[] text arrays,
  case link) and `ballistic_footprints` (signature, weapon, gang link, case link).
- CRUD: "+ Bench" / "+ Footprint" + per-item Edit; RBAC (active create/edit,
  Director/Command delete); empty/sign-in states; realtime.
- Verified: node --check; clean jsdom load; live MCP round-trip on `cid`
  (bench with text[] arrays + footprint linked to gang+case) with cleanup.

## Phase 2 — Module migration #6: Reports (this change)
- **Reports** migrated off localStorage onto Supabase (`reports`): per-case
  chains (Initial → Supplemental #N → Follow-up #N), server-persisted with
  jsonb fields; seq computed server-side; case dropdown + RICO select now source
  live cases (uuid value, case_number label) and refresh after cases load.
- **Finalize + e-signature**: lock-on-finalize sets `finalized` + `signature`
  (officer + badge + timestamp); finalized reports show a signature block and the
  lock badge.
- **PDF export** via jsPDF (CDN, graceful offline fallback) alongside the existing
  dependency-free .docx writer; both include the signature block; Print preserved.
- autoVal now resolves case_number/bureau/detective from live caches.
- Verified: node --check; clean jsdom load (5 templates, sign-in notice, no
  errors); live MCP round-trip on `cid` (report insert with jsonb fields +
  finalize/signature update) with cascade-clean delete.

## Phase 2 — Module migration #7: Trackers (this change)
- **Trackers** migrated off localStorage onto Supabase (`trackers`): deploy
  (command/director signs as Director → status pending), **co-sign** by a second
  command officer (sets deputy_sig + status authorized + expires_at = now +
  duration) — enforces no single-person approval. Live per-second countdown from
  expires_at; **auto-expire** flips status to 'expired' (audit-logged).
- **Notifications**: rows written to `notifications` for the signatories on
  deploy + authorization (surface in the notifications panel — next).
- Signer names resolved via a `profiles` cache (`officerName`). RBAC: deploy/
  co-sign/delete gated to Director/Command; read-only otherwise.
- Case picker sources live cases. Verified: node --check; clean jsdom load
  (sign-in notice, no errors); live MCP round-trip on `cid` (deploy pending →
  authorize + 18h expiry window) with cleanup.

## Phase 2 — Module migration #8: RICO (this change)
- **RICO** migrated off localStorage onto Supabase (`rico_cases` + `predicate_acts`,
  one rico_case per case, created lazily on first action).
- Predicates can **link to a case's evidence row** (`evidence_id` dropdown of the
  case's evidence) or a free-text `evidence_ref`; keeps ≥2-within-10-years
  validation + live readiness meter (red/amber/green).
- RBAC: enterprise link + add predicate = active members; predicate delete =
  Director/Command. Predicate Summary .docx export now reads live data.
- RICO case select sources live cases (uuid). Verified: node --check; clean jsdom
  load (sign-in notice, no errors); live MCP round-trip on `cid`
  (rico_case + enterprise + 2 predicates: one evidence-linked, one ref) with
  cascade-clean delete.

## Phase 2 — Central Command live + Admin + Notifications + Packet + Search (this change)
- **CRITICAL FIX:** `index.html` was still running the **stale pre-split monolith
  inline** and never loaded the external modules — so all prior Phase 2 work was
  orphaned. Replaced the inline `<script>` with `<script src>` for
  `supabase.js` → `app.js` → `auth.js`. The platform is now actually wired.
- **Central Command (live):** KPIs (open/cold cases, persons, total seizures from
  raid_compensations), Odyssey ticket queue from `tickets` + "+ New Ticket";
  **Process Ticket wizard now creates a real `cases` row** and marks the ticket
  processed (with the misroute auto-rename retained); activity feed from
  `audit_log`; bureau caseload computed from live cases.
- **Member administration (Command):** in Personnel, list `profiles` and
  approve/assign role + bureau + active via the `assign_member` RPC — the first
  in-app way to approve members (previously SQL-only).
- **Notifications:** top-bar bell + unread badge + panel (mark-all-read); tracker
  deploy/co-sign already write rows.
- **Case-packet export:** Case Detail → one `.docx` bundling summary + evidence +
  reports + RICO.
- **Global search:** top-bar search now queries Supabase across cases/persons/
  gangs/places (ilike) with a results modal; case hits jump to Case Detail.
- Removed dead dashboard seed consts (KPIS/TICKETS/ACTIVITY/BUREAU_LOAD).
- `supabase.js`: added `rpc()`. Verified: all JS `node --check`; jsdom load
  exercises external modules — 13/13 tabs activate, CIDDB + CIDApp present, gate
  works, no errors.

### Still localStorage (final remaining sliver)
Personnel roster/commendations, the media/evidence vault, the M.O. detector, and
the CID General documents are still client-side; plus a per-module CSV/JSON
importer and their seed removal. These are the last items to migrate.

## Phase 2 — Module migration #9: Personnel, Commendations, Media, M.O. (this change)
- **Personnel roster** now renders from `profiles` (live), not a seed array.
- **Commendations** → Supabase `commendations` table (new migration) with full
  CRUD, edit/delete gating, and realtime.
- **Evidence/media vault** → `media` table: ingest modal writes rows, "forward to
  case" updates `case_id`, tag chips resolve case/gang by id; realtime.
- **M.O. detector** cross-references live `mo_profiles` (per-case indicators);
  "Save as Case Profile" persists a scan; matching jumps off real cases.

## Phase 2 — Module migration #10: CID General "Drive" (this change)
- Folders are now presentation config (`FOLDER_META`); every file is a row in the
  `documents` table. Docs/sheets are editable & shared (realtime); pdf/zip
  read-only; CI Risk Matrix stays a live computed read-only view.
- Editors get "+ New Document" and per-folder import; command/director can delete.

## Phase 3 — Seed removal, bulk import, file split, auth fixes (this change)
### Removed
- **All baked-in demo content.** Domain tables ship empty with "create first" CTAs.
  The CID Drive's 26 seeded templates were deleted (live) and the seed migration
  reduced to a `(folder,name)` unique constraint — the Drive now starts empty.
- Dead `ACTIVE_CASES` constant and the localStorage `caseCounters` sequence; case
  numbers are now derived from existing `cases` (`nextCaseNumber`).
### Added
- **CSV/JSON bulk import per module** (`core.js`): paste a JSON array or CSV (or
  upload a file), allow-listed columns + type coercion, batch insert via Supabase
  (RLS applies), inserted/skipped reporting. "Import" button beside each module's
  "+ New" action (cases, persons, gangs, narcotics, places, ballistics
  benches/footprints, trackers, tickets, commendations, media) and per-folder in
  the Drive.
### Changed
- **Front-end split into 16 feature files** (`core, command, narcotics, ballistics,
  personnel, modus, drive, persons, gangs, places, reports, rico, docx, records,
  casefiles, app`) — classic scripts sharing one global lexical scope, no build
  step. Byte-for-byte contiguous slice of the former monolith (verified), loaded
  in order before `auth.js`.
- Added `AGENTS.md` — architecture + audit guide for future agents.
### Fixed
- **Login blocker:** users created before the profiles trigger existed had no
  `profiles` row (stuck on "pending approval"). Backfilled profiles for all
  pre-existing `auth.users`; seated the owner as Command. New sign-ins already get
  a profile via the `handle_new_user` trigger (verified Google + Discord both work).
