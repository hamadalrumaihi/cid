# React Rebuild Handoff - Phase 3 in progress

Last updated: 2026-07-08 (gangs slice implementation pass).

This branch is `react-rebuild`. The repo root is the Next.js 16 app. The
legacy root static files (`index.html`, root `*.js`, `styles.css`) remain inert
on this branch and must not be edited here.

Companion source of truth: `docs/REACT-PARITY.md`.

## Current state

- Phase 1 is done: app shell, auth gate, navigation, modal/dialog/toast
  primitives, preferences, route placeholders, legacy hash shim.
- Phase 2 implementation is done locally: Cases vertical slice plus Operations.
- Local gates pass after the latest cleanup:
  - `.\node_modules\.bin\tsc.cmd --noEmit`
  - `.\node_modules\.bin\eslint.cmd .`
  - `.\node_modules\.bin\next.cmd build`
- Phase 2 was committed and pushed to `origin/react-rebuild` as
  `b29434d feat(rebuild): finish phase 2 cases slice`.
- The `inbox` / My Desk slice was committed and pushed as
  `e24463c feat(rebuild): add my desk inbox slice`.
- The `command` / Central Command slice was committed and pushed as
  `311a88d feat(rebuild): add central command dashboard slice`.
- The `personnel` / Roster & Member Admin slice was committed and pushed as
  `d849b77 feat(rebuild): add personnel roster and member admin slice`.
- The `announce` / Announcements slice was committed and pushed as
  `1a42119 feat(rebuild): add announcements slice with notification fan-out`.
- The `persons` / Persons of Interest slice was committed and pushed as
  `2d2dcf4 feat(rebuild): add persons intelligence slice`; live browser
  verification is still pending.
- The `gangs` / Gangs & Turf slice was committed and pushed as
  `0f1329f feat(rebuild): add gangs intelligence slice`; live browser
  verification is still pending.
- **Live browser QA completed 2026-07-08** for Phase 2 + inbox + command +
  personnel + announce against the live Supabase project (director account,
  dev server on :3777, Playwright-driven). Full results in
  `docs/REACT-PARITY.md` → "Live QA results". All exercised flows passed;
  zero QA rows left behind (SQL-verified); zero app console errors. One
  cosmetic finding: inbox notification payloads for tracker/stale types
  render raw JSON (fix lands with the Notifications cross-cut). A short list
  of flows still needing a second account or real-data mutation remains in
  the parity doc.

## Phase 2 delivered

Implemented routes:

- `/cases`
- `/cases?case=<id>`
- `/cases?case=<id>&tab=<tab>`
- `/operations`
- `/operations?op=<id>`

Implemented Cases surface:

- Cases grid and board views.
- Persisted My/All scope and Grid/Board view.
- Search, advanced filters, and saved filter views.
- Bulk delete for users who can delete.
- Stale case badges and once-per-session stale escalation using compare-and-swap.
- Case create/edit modal with bureau-prefixed case numbers.
- Case templates and command-only template manager.
- Operation picker and operation chip deep links.
- Pin, recent cases, watch/follow, follow-up date, copy link, packet export.
- Packet `.docx` and `.md` export.

Implemented 11 case detail tabs:

- Overview
- Evidence
- Notes
- Charges
- RICO
- Intel
- Reports
- Tasks
- Signoff
- Chat
- Timeline

Implemented Operations surface:

- Operations card grid with rollup bar.
- Operation detail.
- Link/unlink cases.
- Create/edit/delete operation modal.

Implemented Inbox / My Desk surface:

- `/inbox` route wired through the existing `[tab]` dispatcher.
- Sign-off review, returned, and in-flight queues.
- Due follow-ups and stale visible cases.
- Open case tasks assigned to or created by the current user.
- Recent case-chat mentions.
- Followed case rollup.
- Notifications list with click-to-mark-read.
- Draft report rows linked back to the case Reports tab.

## Command slice delivered

Implemented `/command` (Central Command dashboard) in
`src/components/command/`, wired through the `[tab]` dispatcher:

- 9-card KPI grid (open/awaiting/DOJ-ready/avg-resolution/cold/seizures/
  narcotics/weapons/POI) with tactical `00 // STANDBY` zero-states and
  click-to-drill status toggles. Drill works for every signed-in member;
  only the filter bar is command-gated (matches vanilla).
- Command filter bar (bureau/detective/status/date range) + "X of Y cases"
  count + matching-cases drill list (first 40, click-through to case detail).
- Needs-attention widget: stale ≥14d / no-lead / stuck-in-sign-off columns;
  "all →" routes to Cases with scope=all and the matching saved filter, or
  toggles the awaiting drill in place.
- Bureau scorecards (command only; bureau_lead sees own division) and bureau
  caseload bars (click-to-filter for command) — scorecards stay a standing
  view over the unfiltered cache.
- Crime analytics: clearance/open/BOLO/evidence-30d tiles + single-hue bars
  (cases per month, evidence by type, top gangs by tracked members).
- Odyssey ticket queue: table, New Ticket modal, and the 3-step processing
  wizard (jurisdiction routing with misroute auto-rename, bureau-prefixed
  case number entry with duplicate guard and lead-digit warning, provisioning
  summary; ticket marked processed with case link).
- Division activity feed (last 12 `audit_log` rows).
- GPS trackers: dual-signature flow with self-co-sign blocked, live 1s
  countdown, first-command-viewer auto-expire, authorize modal, delete.
- Raid compensation calculator (brackets + payout split, local preview only).
- Jump-back strip (pins + recents from the shared Store keys) and the
  encouragement widget (session-only dismiss).

Intentionally lean, tracked in `docs/REACT-PARITY.md`:

- Ticket table sort/paging waits on the shared data-table engine.
- CSV/XLSX/JSON bulk import on "+ New" waits on the Imports cross-cut.

## Personnel slice delivered

Implemented `/personnel` in `src/components/personnel/`, wired through the
`[tab]` dispatcher:

- Roster cards from the shared non-email profiles cache: LOA border/badge/dot
  states, badge/bureau/status tiles, 30-per-page load-more.
- Self LOA toggle on my own roster card (auth setMyLoa).
- My Profile editor (`src/components/shell/MyProfileModal.tsx`): display name,
  badge, LOA — also wired to the sidebar officer card (previously a Phase 1
  placeholder). Saves via the new `updateNoSelect` because a member cannot
  read back the command-only email column.
- Member Administration panel (command only): pending-first table with emails
  from the command-gated `admin_member_emails` RPC, one-click approve
  (`assign_member` keep-role + `member_approved` notify), Manage modal
  (role/bureau/active via `assign_member`; name/badge + command-set LOA via
  `updateNoSelect`), permanent removal (`admin_remove_member`, self-block)
  and the removed-members list with restore (`admin_restore_member`).
- Roster-card "Remove from roster" deactivate (assign_member set_active=false).
- Commendations: tinted gradient cards, award/edit modal, command delete with
  undo.
- Data layer: `updateNoSelect` added to `src/lib/db.ts`, closing the tracked
  "non-.select() profile update" gap.

Intentionally lean, tracked in `docs/REACT-PARITY.md`:

- Division Rosters doc shelf (reader, structured roster form editor,
  strike-point/headcount visuals) lands with the `sops` doc engine slice.
- Pending-approval nav badge lands with the Notifications cross-cut.

## Announce slice delivered

Implemented `/announce` in `src/components/announce/`, wired through the
`[tab]` dispatcher:

- Announcement cards: pinned-first amber sort, audience scoping to the
  viewer's division, author/date/audience meta, mention + case-link chips,
  line-clamped body.
- Per-user dismiss (✕) and restore-all, on the same `annDismissed` Store key
  as vanilla; `annSeen` stamped on view for the future unread badge.
- Read modal with mention chips, full body, and linked-record navigation
  (case links deep-link to `/cases?case=<id>`).
- Post/edit/delete modal, gated to LEAD_ROLES (client UX; RLS enforces):
  title/message, audience select, pin-to-top, @mention picker (All Officers /
  role groups / individual officers), link-case picker (recent 30, slim
  projection), token chips.
- Notification fan-out on FIRST post only via the forgery-guarded
  `create_notification` RPC + best-effort discord-notify: audience-scoped
  active roster minus the author; mentioned officers join even outside the
  audience and get a "You were mentioned" reason.

Intentionally lean, tracked in `docs/REACT-PARITY.md`:

- The announce unread nav badge lands with the Notifications cross-cut.

## Persons slice delivered

Implemented `/persons` in `src/components/persons/`, wired through the `[tab]`
dispatcher:

- Persons card grid: 24/page load-more, search reset, quick-add from empty
  search, live refresh, BOLO/8-felony/CCW/VCH/gang/property card signals, and
  mugshots via `safeUrl` with fallback.
- Person create/edit modal: status, alias, gang, CCW, BOLO, VCH, felony count,
  mugshot URL, notes, repeatable known-properties rows, and a gang-preservation
  guard so saving during a partial gang-cache load does not null the current
  gang.
- Command delete flows: one-off delete and bulk multi-select delete using the
  shared undo engine, restoring nulled `gang_members.person_id` and
  `vehicles.owner_id` references on undo.
- Attach-to-case flow posts an intel reference into the selected case channel.
- Unified intel profile slide-over for persons and gangs: linked cases,
  memberships, properties, turf, places, ballistic footprints, media, evidence,
  in-place person/gang cross-links, RLS-restricted linked-case stubs, and case
  deep links.
- Person follow/watch is wired through the shared watchlist store; following
  remains owner-only and never widens case access.
- Person dossier export `.docx` is RLS-scoped and includes profile facts,
  linked cases, warrant reports naming the subject, properties, vehicles,
  memberships, evidence, and media.
- Shared modal scroll lock is now reference-counted so a dialog stacked over a
  slide-over cannot unlock body scrolling while the parent modal remains open.

Intentionally lean, tracked in `docs/REACT-PARITY.md`:

- Dossier `.pdf` waits on the Exports slice.
- Live browser QA for `/persons` is still pending.

## Gangs slice delivered

Implemented `/gangs` in `src/components/gangs/`, wired through the `[tab]`
dispatcher:

- Gang cards: live search, 24/page load-more, threat chips, colors/notes, and
  quick jump into detail or shared intel profile.
- Gang create/edit modal for name, colors, threat level, and notes.
- Command bulk delete and single delete use the shared undo engine, snapshotting
  `gang_members`, `gang_ranks`, and `gang_turf`, plus restoring nulled
  `persons.gang_id` links on undo.
- Detail view: roster grouped by rank, turf panel, linked properties from
  `places.controlling_gang_id`, edit/delete/profile/attach actions.
- Member create/edit/delete: name, rank, callsign, status, linked person,
  linked case, CCW, VCH, felony count, mugshot URL; preserves linked
  person/case options when the current viewer cannot see the referenced row.
- Turf create/delete: block, density, hotspot area.
- Attach-to-case flow posts a gang intel reference into the selected case
  channel.
- Unified gang intel profile reuses the `persons` slice `IntelProfile`.

Intentionally lean, tracked in `docs/REACT-PARITY.md`:

- Gang Intel Library doc shelf lands with the `sops`/document engine.
- CSV/XLSX/JSON bulk import on "+ New" waits on the Imports cross-cut.
- Live browser QA for `/gangs` is still pending.

Implemented shared/data support:

- `db.ts` list projections, `.in`, `updateWhere` CAS predicates, null ordering,
  function invoke, custody join helper, and delete-with-undo engine.
- Realtime table version store and teardown on sign-out.
- Shared format, drafts, markdown, forms, docx, notify, profiles, watchlist,
  operations, signoff, and packet helpers.
- Route wiring in `src/app/(app)/[tab]/page.tsx`.
- Offline Next build fix by removing Google font runtime fetch from
  `src/app/layout.tsx`.

## Phase 2 still requiring live verification

Run the app in a real browser against the live Supabase project. Use the user's
OAuth session; do not read or materialize `sb-*` auth tokens.

Minimum verification checklist:

- Cases list renders real rows.
- Grid/Board toggle persists.
- Drag one case to a different status column and back, leaving data clean.
- Open a case detail page.
- Walk all 11 detail tabs.
- Create and delete a task on an existing case, leaving no test data behind.
- Edit notes, save, and restore the original notes.
- Send and delete your own case chat message.
- Confirm signoff tab gates render correctly for the signed-in role.
- Open operations list and detail.
- Download packet `.md` and `.docx`.
- Confirm no created test rows remain.

Command slice additions to that checklist:

- KPI numbers match the vanilla dashboard for the same account.
- KPI card click toggles the drill list; filter bar renders only for command.
- Needs-attention "all →" lands on Cases with the right filter and scope.
- Process one ticket end-to-end (then delete the created case + reset the
  ticket, leaving data clean).
- Deploy + co-sign a tracker with two command accounts (or verify the
  self-co-sign block), then remove it.
- Raid comp calculator matches the vanilla brackets for a few values.

Personnel slice additions to that checklist:

- Roster renders all non-removed members; removed members absent.
- My Profile save round-trips (name/badge/LOA) and the sidebar card updates.
- Member admin table shows emails (command account only).
- Approve a pending member (or verify none pending renders cleanly).
- Manage modal: change role/bureau on a test-safe account and revert.
- Award, edit, and delete (with undo restore) one commendation.

Announce slice additions to that checklist:

- Post an announcement (command account), confirm the notification lands for
  another member, then delete the announcement and the test notification.
- Dismiss + restore an announcement; confirm `annDismissed` carries over
  between the vanilla app and the rebuild on the same browser.
- Pinned announcement sorts to the top with amber styling.
- Case link chip in the read modal deep-links to the case detail.

Known local dev-server note:

- Hidden attempts to start port `3777` did not leave a server running.
- If needed, try `npm.cmd run dev -- -p 3778` in the foreground.
- The Vercel CLI is not installed. Installing it with `npm i -g vercel` would
  unlock `vercel env pull`, `vercel deploy`, and `vercel logs`, but it is not
  required for local Phase 2 gates.

## Phase 2 intentionally lean or deferred

These are not silent drops; they remain tracked in `docs/REACT-PARITY.md`.

- Evidence bulk quick-log polish and attach-from-vault polish.
- FiveManage media/file upload.
- Packet/report `.pdf` and `.xlsx` exports.
- Case-files attachments route.
- RICO `.docx` export.
- Intel vehicles and profile slide-over.
- Reports supplemental/follow-up chains, report `.docx`, `.pdf`, print flow,
  attached documents, and richer auto-add-person flows.
- Tasks subtasks, done-count badge, and cascade-delete warning polish.
- Chat mentions, access request/grant locked-panel flow, message edit/chips.
- Global bulk registration of all realtime tables.
- CSV/JSON/XLSX bulk import on New actions.
- Command-view jump-back strip rendering.

## Remaining React rebuild plan

The rebuild is still not ready for cutover. `docs/REACT-PARITY.md` tracks 25
views. Done views (implementation passes; live verification pending):

- `cases`
- `operations`
- `inbox`
- `command`
- `personnel`
- `announce`
- `persons`
- `gangs`

Unchecked views remaining:

- `heatmap` - commander heatmap.
- `case-files` - per-case attachments and FiveManage upload.
- `rico` - standalone RICO tracker route and export.
- `bolo` - BOLO board.
- `places` - criminal places and production steps.
- `vehicles` - vehicle registry and cross-reference engine.
- `network` - relationship graph.
- `narcotics` - narcotics intel, precursors, hotspots.
- `ballistics` - ballistics benches and footprints.
- `modus` - M.O. detector and `mo_crossref` flow.
- `media` - media vault and universal intake.
- `records` - CID records registry.
- `penal` - read-only penal catalog.
- `sops` - SOP/library reader and command writes.
- `shifts` - weekly shift reports.
- `audit` - audit log data-table engine.
- `feedback` - feature/bug submissions and triage.

## Remaining cross-cutting systems

- Bureau isolation live verification against RLS.
- Full realtime registry for roughly 31 tables plus teardown.
- Notifications bell, unread count, all notification types, Discord DM invoke.
- Exports beyond Phase 2 `.docx`/`.md`: lazy jsPDF/XLSX, report/dossier/RICO/
  document exports, CSV formula-injection guard.
- Imports for CSV/JSON/XLSX.
- Global search and command palette using `search_all`.
- Watchlist beyond cases: vehicles.
- Never-lose-work coverage for all modal/form drafts.
- Connection watch polish: stale data pulse and retry UX.
- Data-table engine: sort, sticky header, paging, copy IDs, density.
- Card paging/load-more.
- Tactical UI polish, skeletons, sticky modal action bars, and accessibility pass.
- What's-new card.

## Data-layer gaps still tracked

From `docs/REACT-PARITY.md`, remaining `src/lib/db.ts` gaps include:

- `maybeSingle()`.
- Profile non-email projection follow-through and non-`.select()` profile update.
- Delete/update keyed by non-id columns.
- Auth surface helpers.
- Insert without returning select.

## Cutover blockers

Do not cut over to `main` until all of these are true:

- All 25 views are checked in `docs/REACT-PARITY.md`.
- All 11 case tabs remain checked and live-verified.
- Bureau isolation is verified against live RLS.
- Signoff transitions are verified through RPCs only.
- Realtime, notifications, exports, imports, global search, and watchlist are
  complete enough for parity.
- No `dangerouslySetInnerHTML` on dynamic data.
- User URLs flow through `safeUrl()`.
- No service worker is introduced.
- `noindex` remains in place until deliberate cutover.
- Gates pass: `tsc`, `eslint`, and `next build`.

## Suggested next patch order

1. Tackle `bolo` or `places` next. `bolo` can now compose the person/gang
   intelligence surfaces; `places` feeds gang-linked properties and production
   workflows used by narcotics.
2. Continue one view per patch, keeping each patch gated and live-verified.
3. Fold the remaining targeted-QA flows (second account / real-data mutations
   — see the parity doc's Live QA results) into a later joint session.

## Prompt for the next LLM

Use this if another LLM needs to continue from here:

```text
You are continuing work in `C:\Users\hkalr\Desktop\cid\cid` on branch
`react-rebuild`.

Hard rules:
- This branch is a Next.js 16 app at repo root.
- Do not edit legacy static files at repo root (`index.html`, root `*.js`,
  `styles.css`); they are inert on this branch.
- Read relevant local Next docs in `node_modules/next/dist/docs/` before
  writing Next code.
- Use `rg` for search and `apply_patch` for manual edits.
- Do not revert user changes.
- Keep work on `react-rebuild`, never `main`.

Committed baseline:
- Phase 2 Cases + Operations is pushed as
  `b29434d feat(rebuild): finish phase 2 cases slice`.
- Inbox / My Desk is pushed as
  `e24463c feat(rebuild): add my desk inbox slice`.
- Command / Central Command is pushed as
  `311a88d feat(rebuild): add central command dashboard slice`.
- Personnel / Roster & Member Admin is pushed as
  `d849b77 feat(rebuild): add personnel roster and member admin slice`.
- Announce / Announcements has been implemented after that baseline
  (src/components/announce/, wired in src/app/(app)/[tab]/page.tsx).
- Persons / Persons of Interest was pushed as
  `2d2dcf4 feat(rebuild): add persons intelligence slice`
  (src/components/persons/, wired in src/app/(app)/[tab]/page.tsx).
- Gangs / Gangs & Turf was pushed as
  `0f1329f feat(rebuild): add gangs intelligence slice`
  (src/components/gangs/, wired in src/app/(app)/[tab]/page.tsx).

Current completed implementation passes:
- Phase 1 app shell/auth.
- Phase 2 Cases + Operations.
- Oversight `inbox` / My Desk.
- Command `command` / Central Command dashboard.
- Command `personnel` / Roster, Member Admin & Commendations.
- Command `announce` / Announcements + first-post notification fan-out.
- Intelligence `persons` / Persons of Interest + intel profile + dossier export.
- Intelligence `gangs` / Gangs & Turf + roster/turf + shared intel profile.

Known local junk to ignore unless the user explicitly asks otherwise:
- `.serena/`
- `bash.exe.stackdump`

Next recommended slice:
- `bolo` / BOLO Board for a smaller intelligence follow-up, or `places` if the
  next patch should keep building the gang/narcotics data chain.

Before changing code:
- Read `docs/REACT-PARITY.md` and this handoff.
- Inspect current git status.
- Verify any Next App Router behavior from local Next 16 docs.

After changes:
- Update `docs/REACT-PARITY.md` honestly.
- Keep this handoff current.
- Run:
  `.\node_modules\.bin\tsc.cmd --noEmit`
  `.\node_modules\.bin\eslint.cmd .`
  `.\node_modules\.bin\next.cmd build`
```
