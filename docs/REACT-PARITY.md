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
- [x] **Phase 2** — Cases vertical slice implementation pass: cases grid/board,
      filters/saved views, stale badges/escalation, bulk delete, templates,
      operations picker/view, detail shell, 11 tabs, packet .docx/.md. Gates green.
      **Live-verified 2026-07-08** (see "Live QA results" below); several dense vanilla
      subflows are intentionally lean in React v1 and called out below.
- [ ] **Phase 3+** — one view per patch (order below). Done so far: `inbox` (My Desk),
      `command` (Central Command), `personnel` (Roster & Member Admin), `announce`
      (Announcements), `persons` (Persons of Interest), `gangs` (Gangs & Turf),
      `bolo` (BOLO Board), and `places` (Criminal Places & Production). The first
      four are **live-verified 2026-07-08** alongside Phase 2; `persons`, `gangs`,
      `bolo`, and `places` are implementation-complete with local gates green, live
      verification pending.

### Live QA results (2026-07-08, real browser + live Supabase, director account)
All flows exercised with throwaway rows; SQL sweep confirmed **zero QA rows left**
across cases/tickets/trackers/operations/commendations/announcements/tasks/messages/
notifications. Zero app console errors (incl. NO vanilla rt_cases double-subscribe).
- command: KPI numbers live; drill toggle + "X of Y" + matching list; filter bar
  (command-gated, detectives populated); scorecards/caseload/analytics; ticket wizard
  end-to-end (misroute rename ticket→blaine, BCB prefix + lead digit, processed chip);
  tracker deploy → **self-co-sign blocked** → remove; raid comp brackets exact;
  needs-attention live; activity feed realtime-bumped on tracker insert.
- cases: list + grid/board toggle (persisted to `cid-portal-v3`), deep link
  `?case=<id>`, all 11 tabs render live; notes save + safe-markdown render; task
  create/delete; chat send/delete; packet .docx (valid OOXML) + .md (notes included);
  case delete w/ undo-offer confirm.
- operations: create → detail (deep link `?op=<id>`, link-case picker) → delete.
- inbox: all 9 panels live; stat tiles; click-to-mark-read (unread 1→0);
  tracker_pending fan-out landed. **Finding**: tracker/stale notification payloads
  render raw JSON via payloadText fallback — **closed 2026-07-08** by the
  Notifications cross-cut (shared `lib/notifText` vocabulary; payloadText removed).
- personnel: roster + emails via `admin_member_emails` (command); removed-member list
  renders w/ Restore; My Profile LOA round-trip (modal set → sidebar badge → roster
  card clear); commendation award/delete w/ undo.
- announce: pinned post w/ audience meta + case-link chip; **fan-out verified by SQL**
  (4 recipients, correct "New announcement:" reason, author excluded); dismiss →
  `annDismissed` Store key → restore; delete.
- Still needing a targeted pass (needs second account / would mutate real data):
  board drag persistence, saved filter views, case create/edit modal + templates,
  bulk multi-select delete, watch/follow, sign-off RPC transitions, operation
  link/unlink commit, mention-expansion fan-out, member approve + role/bureau
  assign + permanent remove/restore, announce cross-app dismiss carry-over.

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
- [x] **command** — implementation pass, live-verified 2026-07-08: 9-card KPI
      grid w/ click-to-drill (drill works for every member; filter BAR is command-only);
      filter bar (bureau/detective/status/date) + matching-cases drill list (first 40);
      bureau scorecards (bureau_lead sees own division only; standing view, unfiltered);
      needs-attention widget (stale ≥14d / unassigned / stuck sign-off; "all →" routes to
      the Cases list with scope=all + matching filter); crime analytics tiles + bars;
      Odyssey ticket queue + New Ticket modal + 3-step wizard → case (misroute rename,
      bureau-prefixed number, duplicate guard, ticket → processed); division activity feed
      (audit_log, last 12); bureau caseload bars (click-to-filter for command); GPS
      trackers w/ dual digital signatures (self-co-sign blocked) + live 1s countdown +
      first-command-viewer auto-expire; raid compensation calculator; jump-back strip
      (pins + recents); encourage widget (session dismiss). **Lean in v1**: ticket table
      sort/paging waits on the Data-table engine; CSV/XLSX/JSON bulk import on "+ New"
      waits on the Imports cross-cut.
- [x] **announce** — implementation pass, live-verified 2026-07-08:
      announcement cards (pinned amber-first sort, audience scoping to my division,
      mention/link chips); per-user dismiss + restore-all on the vanilla `annDismissed`
      Store key; `annSeen` stamped for the future unread badge; read modal with linked-
      record navigation; post/edit/delete modal (LEAD_ROLES gate) with audience select,
      pin, @mentions (all/role/officer) and case links; **notification fan-out on first
      post only** via `create_notification` (mentioned officers get "You were mentioned"
      and join even outside the audience). **Lean in v1**: the announce unread nav badge
      is still pending (nav-badge polish; the header bell itself landed 2026-07-08).
- [ ] **heatmap** — Commander heatmap (stylized SA map, incident density).
- [x] **personnel** — implementation pass, live-verified 2026-07-08: roster
      cards (LOA state, badge/bureau/status tiles, 30/page load-more); self LOA toggle +
      My Profile editor (also wired to the sidebar officer card; saves via the new
      non-returning profile update); member admin panel (pending-first table, one-click
      approve + member_approved notify, Manage modal w/ role/bureau via `assign_member`,
      name/badge, command-set LOA, **permanent removal + restore** via
      `admin_remove_member`/`admin_restore_member`, removed-members list; emails via
      command-gated `admin_member_emails`); roster-card deactivate (set_active=false);
      commendations grid + award/edit modal + command delete w/ undo. **Lean in v1**:
      Division Rosters doc shelf (reader + structured roster form editor + strike-point/
      headcount visuals) lands with the `sops` doc engine; pending-approval nav badge
      is still pending (nav-badge polish; the header bell itself landed 2026-07-08).

### Cases
- [x] **cases** — Case Files (heaviest; see case-detail tabs below): grid + drag kanban
      board (Grid/Board toggle persisted; drag = canEdit); My/All chips + search; advanced
      filters (bureau/status/lead/stale) + **named saved views** (localStorage); stale ≥14d
      badges + one-shot auto-escalation (compare-and-swap on `last_stale_notified_at`);
      bulk multi-select hard delete (canDelete); **quick-create case templates**
      (`case_templates` chips + command-only Template Manager); court packet export
      **.docx/.md** (`.pdf/.xlsx` deferred to Exports); pin, copy deep-link (`#case=<id>`), watch/follow,
      follow-up date, quick status select, operation chip.
- [x] **operations** — Operations/Task Forces: cards w/ proportional status rollup bar;
      detail w/ link/unlink case picker; CRUD modals; deep link.
- [ ] **case-files** — per-case attachments (FiveManage upload; `case_files` keyed by
      case_number; RLS `can_access_case_number`).
- [ ] **rico** — RICO element tracker: enterprise + predicate acts; .docx export.

### Intelligence
- [x] **persons** — implementation pass, local gates green 2026-07-08: paged
      card grid (24/page + load-more, search reset), quick-add from empty
      search, bulk delete with undo restoring nulled `gang_members.person_id`
      and `vehicles.owner_id`, CRUD modal with known-properties editor and
      gang-preservation guard, BOLO/8-felony/CCW/VCH card signals, mugshots via
      `safeUrl`, attach-to-case reference posting, person follow/watch, unified
      intel profile slide-over for persons and gangs with RLS-restricted linked
      case stubs, and RLS-scoped dossier export `.docx`. **Lean in v1**: dossier
      `.pdf` waits on the Exports slice; live browser verification still pending.
- [x] **bolo** — implementation pass, local gates green 2026-07-08:
      RLS-scoped active BOLO person board, search by name/alias/status/gang,
      latest warrant-status chip from accessible warrant reports naming the
      subject, mugshots via `safeUrl`, armed/felony/gang/status chips, shared
      intel profile, edit person, and clear-BOLO action. **Lean in v1**:
      vehicle-specific BOLO behavior now has its registry (vehicles slice); live
      browser verification still pending.
- [x] **gangs** — implementation pass, local gates green 2026-07-08: gang
      cards with 24/page load-more, search, threat chips, bulk command delete
      with undo snapshotting `gang_members`/`gang_ranks`/`gang_turf` and
      restoring nulled `persons.gang_id`, create/edit gang modal, detail view
      with roster grouped by rank, member create/edit/delete with preserved
      person/case links, turf create/delete, linked properties, attach-to-case
      reference posting, and unified gang intel profile via the shared
      `IntelProfile`. **Lean in v1**: Gang Intel Library document shelf waits
      on the `sops`/document engine; live browser verification still pending.
- [x] **places** — implementation pass, local gates green 2026-07-08:
      criminal-place cards, linked gang/case/narcotic chips, production
      process display from stored `place_process_steps` or generated drug-lab
      recipe, FK-preserving create/edit modal, attach-to-case reference posting,
      and command delete/bulk delete with undo snapshotting process steps.
      **Lean in v1**: manual process-step editing and bulk import wait on later
      cross-cuts; live browser verification still pending.
- [x] **vehicles** — implementation pass 2026-07-08, local gates green (live
      verification pending): plate-card registry (owner/gang chips via slim
      projections, notes, plate chip), filter box seeded from global-search
      `?q=`, create/edit modal with FK-preservation guard on owner/gang
      selects (a failed options fetch can't silently null a link), uppercase
      plate + friendly duplicate-plate error, delete w/ undo, per-vehicle
      follow (WatchButton type='vehicle' — closes the watchlist vehicles gap).
      Cross-reference engine ported: RLS-scoped scan of reports +
      case_intel_links flags phones / registered plates / linked persons in
      2+ cases, with clickable case-number deep links; a failed scan shows a
      Retry banner, never a false "no matches". `search_all` now returns the
      plate as `term` for vehicle hits (live migration
      `search_all_vehicle_term`, backward-compatible) so palette results land
      here prefiltered.
- [ ] **network** — Relationship network graph.
- [x] **narcotics** — implementation pass 2026-07-08, local gates green (live
      verification pending): accordion registry (first open) with what-if
      purity sliders (client-only, keyed by precursor id), pricing matrix
      bars, hotspot list (density tint + case chip), tracked/hotspot count
      tiles; CRUD modal with dynamic precursor/hotspot row editors using the
      delete-then-reinsert children pattern via the new `removeWhere` db.ts
      helper (closes that data-layer gap).
- [x] **ballistics** — implementation pass 2026-07-08, local gates green (live
      verification pending): street/organized bench tabs (persisted on the
      vanilla `benchType` Store key), tier/heat tints, outputs + component
      tracing, linked-case chips, bench CRUD modal (datalist tier/heat);
      ballistic footprint log with gang/case links + CRUD modal.
- [ ] **modus** — M.O. detector & profiler: `mo_crossref` RPC (deliberate cross-bureau
      leak valve: case_number+bureau+indicator only → "request access" flow).
- [ ] **media** — Media vault (universal intake via FiveManage; paste-URL fallback).
- [x] **records** — implementation pass 2026-07-08, local gates green (live
      verification pending): live shared registry on `cid_records` (realtime via
      the rt_ registry — one channel per table, replacing vanilla's bespoke
      `cid_records_live` channel), live dot, filter + 24/page load-more, mugshot
      via safeUrl with graceful fallback, create/edit modal (11 REC_FIELDS,
      dirty-guarded). Vanilla's zero-row-update rule preserved: an RLS-blocked
      edit (not creator/command) surfaces "You can only edit records you
      created", never a false success.

### Reference
- [x] **penal** — implementation pass 2026-07-08, local gates green (live
      verification pending): read-only searchable statute list (162 charges via
      penalSearch), level tint + sentence + fine + RICO badge, live count
      readout; `?q=` seeds the search box so global-search charge hits land
      prefiltered (palette Q_SEEDED_TABS includes penal).
- [ ] **sops** — SOPs & Library: doc cards; reader engine (sop-prose typography,
      pipe-tables, safe mini-Markdown, roster visuals); doc/sheet/form/matrix viewers;
      version history; structured roster form editor; command-only writes (RLS folder
      guard); content synced by `sops-sync` edge function (backend — unaffected by rebuild).

### Oversight
- [x] **inbox** — My Desk implementation pass, live-verified 2026-07-08: sign-off
      review/returned/in-flight queues, due follow-ups, stale visible cases, my open
      tasks, recent mentions, followed cases, unread notifications (click-to-mark-read),
      and draft report rows. Richer followed-item delta/badge behavior still pending.
- [x] **shifts** — implementation pass 2026-07-08, local gates green (live
      verification pending): weekly report list (bureau + author + "you"
      badge, own-report edit), new/edit modal with the auto-fill rollup
      (cases I led that moved in the chosen week + evidence I collected),
      Monday-normalized week picker, friendly duplicate-week error
      ("edit it instead"), realtime refresh.
- [x] **audit** — implementation pass 2026-07-08, local gates green (live
      verification pending): owner-only view (AUDIT_OWNER_ID UI gate matching
      the audit_sel RLS policy; restricted notice otherwise), filter across
      action/entity/officer/detail, 4 sortable columns, 50/page pager,
      click-to-copy entity ids. Uses a compact local table for now — the
      shared data-table engine cross-cut will absorb it later. Writes remain
      server-trigger-only (no client write path).

### Standalone
- [x] **feedback** — implementation pass 2026-07-08, local gates green (live
      verification pending): submit form (kind/title/details, Enter submits),
      member view (own submissions + withdraw), owner triage (open/closed
      sections, done / reopen / won't-fix, delete) gated by
      FEEDBACK_OWNER_IDS (now exported from lib/nav; RLS enforces
      server-side).

## Case detail — 11 tabs
- [x] overview · [x] **notes** (Markdown render/edit, copy + .md)
- [x] evidence (evidence CRUD, custody append, media links; bulk quick-log and vault attach
  remain Media/Imports polish) · [x] charges (penal picker + auto-recommendations) ·
  [x] rico (enterprise + predicates; RICO .docx export deferred) · [x] intel
  (linked persons/gangs/places; vehicles/profile slide-over deferred)
- [x] reports (FORM_SCHEMAS editor, view, delete w/ undo, finalize via
  `report_finalize` RPC, .md; supplemental/follow-up chains, .docx/.pdf/print, attached
  documents are still Reports/Exports polish)
- [x] tasks (assignable checklist; sub-tasks/done-count/cascade warning still lean) ·
  [x] **signoff** (RPC-only submit/decide/owner-action + history; completeness pre-check
  still server/UX polish) · [x] chat (case messages with delete; mentions and access
  request/grant locked-panel flow still lean) · [x] timeline (merged case/evidence/
  reports/tasks/sign-off/follow-up events)

## Cross-cutting systems
- [x] **Auth gate** (Phase 1) — magic-link + Discord + Google OAuth; gate states as
      conditional rendering (loading/setup/out/pending/error/in); profile fetch with
      **non-email column list**; Discord id capture → `profiles.discord_id`; sequenced
      evaluations; LOA self-service (command-set-LOA comes with Personnel slice).
      Live-verified: real OAuth round-trip, LOA set/clear confirmed via SQL.
- [x] **Sign-off chain** — all transitions via SECURITY DEFINER RPCs ONLY
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
- [x] **Notifications** — implementation pass 2026-07-08 (live verification pending):
      header bell + unread badge (9+ cap, hidden at 0), realtime-bumped via
      `rt_notifications`; panel modal with per-type titles from the shared
      `lib/notifText` vocabulary (vanilla NOTIF_LABEL + `member_approved`/`mention`/
      both stale-case spellings — unknown types show the raw type string, never JSON);
      mono detail line (case number/tracker/target + actor) + reason line; row click
      marks read (optimistic, rolls back on error) and deep-links `?case=` when the
      payload carries one; mark-all-read. My Desk's unread panel now renders through
      the same helper — closes the raw-JSON `payloadText` finding from the inbox QA.
      Writes were already live via the forgery-guarded `create_notification` RPC +
      fire-and-forget discord-notify (lib/notify.ts).
- [ ] **Exports** — dependency-free OOXML .docx writer (letterhead + LES banner); lazy
      jsPDF/XLSX (npm packages in React — CDN pins were a vanilla workaround; keep
      xlsx CVE-2023-30533 in mind: use ≥0.20.x); case packet 4 formats; report/dossier/
      RICO/doc-library exports; CSV export w/ formula/DDE-injection guard; .md packet +
      notes download; clipboard copy helpers.
- [ ] **Imports** — CSV/JSON/XLSX bulk import on every "+ New" (template CSV download,
      dedupe probe).
- [x] **Global search** — implementation pass 2026-07-08 (live verification pending):
      one palette merges the vanilla top-bar deep search + Cmd-K command palette,
      backed by the `search_all` pg_trgm RPC (typo-tolerant, ranked, RLS-scoped
      SECURITY INVOKER) + client-side penal-charge matches (static reference data,
      vanilla parity). Cmd/Ctrl-K opens anywhere; Enter in the header box opens
      seeded with the query; `/` focuses the box; arrows/enter/esc; 200ms debounce
      with sequence guard; distinct loading/error/no-match states. Recent searches
      on the SAME Store key (`recentSearches`) so history survives cutover. Result
      navigation: case → `/cases?case=<id>`; persons/gangs land with `?q=<term>`
      seeding the view filter (new `?q=` support in those views); other kinds route
      to their tab (placeholders until their slices land).
- [x] **Watchlist/follow** — cases/persons/vehicles all wired (vehicles landed
      with the vehicles slice 2026-07-08). Owner-only RLS; "following never
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
- [x] `select` projection option on list (operations picker, intel, inbox rollups)
- [x] `.in()` filter (deleteWithUndo snapshots, custody/evidence/reports by case ids)
- [x] embedded-relation select w/ inner-join filter (`custody_chain` + `evidence!inner`)
- [ ] `maybeSingle()` as a first-class db.ts helper (auth.tsx still calls the raw client).
      Profiles **non-email projection** ✅ (ROSTER_COLS/PROFILE_COLS) and non-`.select()`
      profile update ✅ (`updateNoSelect`, Personnel slice) are closed.
- [x] delete keyed by non-id columns (`removeWhere` — narcotics children;
      profile-by-uid update still via updateWhere)
- [x] conditional update predicates (`.eq` extra col / `.is null`) for CAS
- [x] `nullsFirst` order option (case_tasks due)
- [x] realtime `subscribe(table, cb)` + subscribeOnce registry + teardown
- [x] `functions.invoke('discord-notify')`
- [ ] auth surface (session, onAuth, OAuth google/discord, magic link, signOut) +
      role helpers (me/isAdmin/canDelete/canEdit)
- [ ] insert without returning select (documents_versions; avoids requiring SELECT RLS)
- [x] `deleteWithUndo` engine (snapshot children → delete → undo toast re-insert)

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
