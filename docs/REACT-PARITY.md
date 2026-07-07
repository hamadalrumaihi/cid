# React Rebuild — Parity Checklist

Living scope document for the `react-rebuild` branch (PR #61, draft).
The vanilla app on `main` is the reference implementation and stays live until
**every** box here is checked and we deliberately cut over. Updated every patch.

Source of truth for scope: full-code sweep of the vanilla app at `main` f592234
(25 views verified — 25 `<section id="view-*">` in index.html; PAGE_META declares 26
route ids but the legacy `reports` route has no section and falls back to `cases`).

- Hard rules: see PR #61 description / task brief. RLS is the authority; db.ts contract
  (lists throw, mutations return `{error}`, RPCs via client); React auto-escaping only
  (no `dangerouslySetInnerHTML` on user/DB data); `safeUrl()` on user URLs; anon key only;
  same `cid-portal-v3` localStorage blob; no service worker; `noindex`.
- Schema note: `case_tasks.parent_id` and `operations` were applied to the LIVE database
  via MCP and have **no migration file in the repo** — `src/lib/database.types.ts` is
  generated from the live schema (46 tables) and is the schema authority for the React app.

## Status

- [x] **Step 0** — rebased onto main f592234; live types regenerated; gates green
      (`tsc --noEmit` / `eslint` / `next build`); anon RLS probe verified
      (`cases` → 200 `[]`, `search_all` callable, RLS-scoped).
- [x] **Phase 1** — app shell: auth gate (all 6 states), two-tier nav + drawer +
      bottom bar + collapse, modal/dialog/toast primitives, appearance, route
      placeholders + legacy-hash shim, continuity fixes. Live-verified in a real
      browser: Discord OAuth in, profile render, LOA set/clear round-trip
      (SQL-confirmed clean), appearance apply, modal Esc. Search/bell are stubs
      until their slices.
- [ ] **Phase 2** — Cases vertical slice (proves the pattern)
- [ ] **Phase 3+** — one view per patch (order below)

### Owner actions (infrastructure)
- [x] Supabase Auth redirect allow-list: `http://localhost:3777/**` added
      (2026-07-07) — OAuth used to bounce to the Site URL (vanilla prod).
- [ ] Add the react-rebuild Vercel **preview URL pattern** to the same allow-list
      before preview testing, and the production domain at cutover.
- Found along the way (vanilla, `main`): console error `cannot add
  postgres_changes callbacks for realtime:rt_cases after subscribe()` from
  supabase.js:79 via inbox.js onAuthed re-registration — pre-existing, not
  caused by the rebuild; fix on `main` separately.

---

## Views (25) — by nav category

### Command
- [ ] **command** — Central Command dashboard: KPI grid w/ drill-down; command-only filter
      bar (bureau/detective/status/date) + bureau scorecards (CMD_ROLES; bureau_lead sees
      own bureau only); needs-attention widget (stale ≥14d / unassigned / stuck sign-off);
      crime analytics tiles + bars; Odyssey ticket queue + 3-step wizard → case; division
      activity feed; bureau caseload bars; GPS trackers w/ dual digital signatures
      (self-co-sign blocked) + live countdown; raid compensation calculator; jump-back
      strip (pins + recents); encourage widget; CSV/XLSX/JSON bulk import on every "+ New".
- [ ] **announce** — Announcements: post/pin/delete (LEAD_ROLES gate), notification fan-out.
- [ ] **heatmap** — Commander heatmap (stylized SA map, incident density).
- [ ] **personnel** — Personnel/Roster & Commendations: roster cards w/ strike-point bars +
      per-section headcount tiles; commendations; member admin (approve pending, role/bureau
      assign via `assign_member`, LOA, **permanent removal + restore** via
      `admin_remove_member`/`admin_restore_member`; emails via `admin_member_emails` —
      command-only column grant); Division Rosters doc shelf (structured form editor).

### Cases
- [ ] **cases** — Case Files (heaviest; see case-detail tabs below): grid + drag kanban
      board (Grid/Board toggle persisted; drag = canEdit); My/All chips + search; advanced
      filters (bureau/status/lead/stale) + **named saved views** (localStorage); stale ≥14d
      badges + one-shot auto-escalation (compare-and-swap on `last_stale_notified_at`);
      bulk multi-select hard delete (canDelete); **quick-create case templates**
      (`case_templates` chips + command-only Template Manager); court packet export
      **.docx/.pdf/.xlsx/.md**; pin, copy deep-link (`#case=<id>`), watch/follow,
      follow-up date, quick status select, operation chip.
- [ ] **operations** — Operations/Task Forces: cards w/ proportional status rollup bar;
      detail w/ link/unlink case picker; CRUD modals; deep link.
- [ ] **case-files** — per-case attachments (FiveManage upload; `case_files` keyed by
      case_number; RLS `can_access_case_number`).
- [ ] **rico** — RICO element tracker: enterprise + predicate acts; .docx export.

### Intelligence
- [ ] **persons** — Persons of Interest: paged card grid (24/page), warrants lifecycle,
      BOLO flag, watch/follow, intel profile slide-over, **dossier export .docx/.pdf**
      (RLS-scoped), mugshots via `safeUrl`.
- [ ] **bolo** — BOLO board (persons + vehicles).
- [ ] **gangs** — Gangs & Turf: gang cards, ranks, members, turf; Gang Intel Library doc
      shelf; intel profile.
- [ ] **places** — Criminal places & production (process steps).
- [ ] **vehicles** — Vehicle registry + cross-reference engine; watch/follow.
- [ ] **network** — Relationship network graph.
- [ ] **narcotics** — Narcotics intel: precursors + hotspots (delete-then-reinsert
      children pattern).
- [ ] **ballistics** — Ballistics & logistics benches + footprints.
- [ ] **modus** — M.O. detector & profiler: `mo_crossref` RPC (deliberate cross-bureau
      leak valve: case_number+bureau+indicator only → "request access" flow).
- [ ] **media** — Media vault (universal intake via FiveManage; paste-URL fallback).
- [ ] **records** — CID Records: separate live registry (`cid_records`), own realtime
      channel + status dot.

### Reference
- [ ] **penal** — Penal Code catalog (read-only searchable; same 162-charge dataset as
      the charge picker).
- [ ] **sops** — SOPs & Library: doc cards; reader engine (sop-prose typography,
      pipe-tables, safe mini-Markdown, roster visuals); doc/sheet/form/matrix viewers;
      version history; structured roster form editor; command-only writes (RLS folder
      guard); content synced by `sops-sync` edge function (backend — unaffected by rebuild).

### Oversight
- [ ] **inbox** — My Desk: sign-off inbox (review/bounced/mine), overdue ≥14d, due
      follow-ups, needs-attention nudges, unread @mentions, followed-items-changed,
      my case tasks.
- [ ] **shifts** — Weekly shift reports (author-or-command RLS).
- [ ] **audit** — Audit log on the data-table engine (sort/paginate/copy-ID); owner-only
      (RLS + hidden subtab; writes happen ONLY via `private.audit()` trigger on 16 tables).

### Standalone
- [ ] **feedback** — Feature/bug submissions; triage gated to owner UUIDs (RLS-matched).

## Case detail — 11 tabs
- [ ] overview · [ ] **notes** (Markdown working page; unsaved-guard; copy + ⬇.md)
- [ ] evidence (chain-of-custody, bulk intake, quick-log) · [ ] charges (penal picker +
  auto-recommendations) · [ ] rico · [ ] intel (linked persons/gangs/places/vehicles)
- [ ] reports (template chains via FORM_SCHEMAS, finalize via `report_finalize` RPC,
  supplemental/follow-up, delete w/ undo, .docx/.pdf/print, attached documents)
- [ ] tasks (assignable checklist + **sub-tasks** via `parent_id`, done-count badges,
  cascade delete warning) · [ ] **signoff** (chain below) · [ ] chat (mentions;
  **cross-bureau access request/grant flow** — locked tab → `case_access_requests`,
  command/owner approves → `case_access_grants`) · [ ] timeline (auto-merged events +
  task events + follow-up milestone; scroll-driven)

## Cross-cutting systems
- [x] **Auth gate** (Phase 1) — magic-link + Discord + Google OAuth; gate states as
      conditional rendering (loading/setup/out/pending/error/in); profile fetch with
      **non-email column list**; Discord id capture → `profiles.discord_id`; sequenced
      evaluations; LOA self-service (command-set-LOA comes with Personnel slice).
      Live-verified: real OAuth round-trip, LOA set/clear confirmed via SQL.
- [ ] **Sign-off chain** — all transitions via SECURITY DEFINER RPCs ONLY
      (`signoff_submit` owner-only; `signoff_decide` exact-role-at-stage;
      `signoff_owner_action`); statuses none→awaiting_bureau_lead→awaiting_deputy→
      approved_deputy→awaiting_director→ready_doj→approved_complete (+changes_requested,
      denied); LOA-aware routing; completeness pre-check (non-blocking); history table.
      Client NEVER patches `cases.signoff_*`.
- [ ] **Bureau isolation** — rely on RLS `can_access_case` (JTF shared; own bureau;
      owner/creator; command cross-cut; explicit grants). Client renders what RLS returns;
      client filters are convenience only.
- [ ] **Realtime** — ~31 subscriptions: 27 tables bulk-registered once per authed session
      + `cid_records` channel + per-case chat; dedupe registry; teardown on sign-out
      (`removeAllChannels`).
- [ ] **Notifications** — bell + unread count; `create_notification` RPC (forgery-guarded);
      19 types; discord-notify edge function DMs.
- [ ] **Exports** — dependency-free OOXML .docx writer (letterhead + LES banner); lazy
      jsPDF/XLSX (npm packages in React — CDN pins were a vanilla workaround; keep
      xlsx CVE-2023-30533 in mind: use ≥0.20.x); case packet 4 formats; report/dossier/
      RICO/doc-library exports; CSV export w/ formula/DDE-injection guard; .md packet +
      notes download; clipboard copy helpers.
- [ ] **Imports** — CSV/JSON/XLSX bulk import on every "+ New" (template CSV download,
      dedupe probe).
- [ ] **Global search** — top-bar + command palette (Cmd/Ctrl+K, arrows/enter/esc);
      `search_all` pg_trgm RPC (typo-tolerant, ranked, RLS-scoped SECURITY INVOKER);
      recent-search memory; `/` focuses search.
- [ ] **Watchlist/follow** — cases/persons/vehicles; owner-only RLS; "following never
      widens access"; feeds My Desk.
- [ ] **Never-lose-work** — `cid-draft:<key>` form drafts; dirty-guard on modal close;
      beforeunload prompt.
- [ ] **Connection watch** — offline banner ✅ (Phase 1) · `withRetry` + data-stale
      pulse pending (land with first data views).
- [ ] **Deep links** — legacy-hash redirect shim + tab persistence ✅ (Phase 1) ·
      `/cases?case=<id>` handling lands with the Cases slice.
- [ ] **Data-table engine** — sortable/sticky/paged (50), click-to-copy IDs, density.
- [ ] **Card paging** — 24/page (roster 30) + Load-more.
- [ ] **Theming/appearance** — accent (default amber) + density + appearance modal +
      `humanizeError` ✅ (Phase 1) · skeleton loaders, sticky modal action bars, a11y
      pass, tactical hardware-instrument skin (View Transitions, film grain, status
      stripes) land with the data views.
- [ ] **Stale-case auto-escalation** — once/session, CAS-guarded notify lead + bureau
      command.
- [ ] **What's-new card** — once per version per browser.
- [x] **PWA manifest** (Phase 1) — served from `public/manifest.webmanifest`, linked
      via metadata; **NO service worker** (hard rule).

## Data layer — gaps to close in `src/lib/db.ts`
Contract holds (lists throw / mutations `{error}` / typed RPCs; all 46 tables + all 11
RPCs typed). Missing capabilities, add as first-class helpers as slices need them:
- [ ] `select` projection option on list (operations picker, intel, inbox rollups)
- [ ] `.in()` filter (deleteWithUndo snapshots, custody/evidence/reports by case ids)
- [ ] embedded-relation select w/ inner-join filter (`custody_chain` + `evidence!inner`)
- [ ] `maybeSingle()` + profiles **non-email projection** (and non-`.select()` update for
      profiles — current `update().select()` breaks under the email column grant)
- [ ] delete/update keyed by non-id columns (narcotics children; profile-by-uid)
- [ ] conditional update predicates (`.eq` extra col / `.is null`) for CAS
- [ ] `nullsFirst` order option (case_tasks due)
- [ ] realtime `subscribe(table, cb)` + subscribeOnce registry + teardown
- [ ] `functions.invoke('discord-notify')`
- [ ] auth surface (session, onAuth, OAuth google/discord, magic link, signOut) +
      role helpers (me/isAdmin/canDelete/canEdit)
- [ ] insert without returning select (documents_versions; avoids requiring SELECT RLS)
- [ ] `deleteWithUndo` engine (snapshot children → delete → undo toast re-insert)

## Continuity debts (hard rule #5) — CLOSED in Phase 1
- [x] **Pref applier**: pre-hydration script reads `cid-portal-v3`, applies
      `body[data-accent]` (default **amber**), `html[data-density]`, `nav-collapsed`;
      values allow-listed. Verified live: vanilla-written blob (emerald/compact)
      applied before first paint.
- [x] **penal.ts**: `stack` (25), `arrest` (11), `rico` (24) flags restored +
      all helpers ported; per-code parity vs penal.js machine-verified.
- [x] **roles.ts**: `ROLE_ORDER`/`rank()`, `bureauLabel()`, `isSubmitRole()`,
      active-aware `meIsCommand()` ported.
- [x] localStorage key/shape (`cid-portal-v3`) — already compatible.
- [x] `safeUrl` — verbatim-equivalent port, no drift.

## RPCs (11 — all typed in database.types.ts)
`admin_member_emails` · `admin_remove_member` · `admin_restore_member` · `assign_member` ·
`create_notification` · `mo_crossref` · `report_finalize` · `search_all` ·
`signoff_decide` · `signoff_owner_action` · `signoff_submit`

## Cutover criteria (Definition of Done)
All 25 views + 11 case tabs checked · sign-off chain + bureau isolation behave
identically (verified against live RLS) · exports (.docx/.md at minimum) work ·
realtime wired · fuzzy search wired · device prefs carry over (amber default!) ·
no `dangerouslySetInnerHTML` on dynamic data · no service worker · `noindex` ·
gates green. Only then: cutover PR to `main`.
