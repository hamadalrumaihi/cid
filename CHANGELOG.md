# CHANGELOG — CID Portal → Production Platform

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
