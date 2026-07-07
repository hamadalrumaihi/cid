# React Rebuild Handoff - After Phase 2

Last updated: 2026-07-08.

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
- The next slice, `inbox` / My Desk, has an implementation pass in this
  handoff state.
- Live browser verification for Phase 2 is still pending.

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
views. Done views:

- `cases`
- `operations`
- `inbox`

Unchecked views remaining:

- `command` - Central Command dashboard, trackers, raid compensation, jump-back
  strip, command rollups, imports.
- `announce` - announcements, pin/delete, notification fan-out.
- `heatmap` - commander heatmap.
- `personnel` - roster, commendations, member admin, division roster docs.
- `case-files` - per-case attachments and FiveManage upload.
- `rico` - standalone RICO tracker route and export.
- `persons` - POI cards, warrants, BOLO, watch/follow, dossiers.
- `bolo` - BOLO board.
- `gangs` - gangs, ranks, members, turf, gang intel library.
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
- Watchlist beyond cases: persons and vehicles.
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

1. Finish Phase 2 live browser QA and update `docs/REACT-PARITY.md` with results.
2. Tackle `command`, because it exercises the broadest operational rollups.
3. Tackle `personnel`, because it closes member admin and role-management flows.
4. Continue one view per patch, keeping each patch gated and live-verified.

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
- Inbox / My Desk has now been implemented after that baseline.

Current completed implementation passes:
- Phase 1 app shell/auth.
- Phase 2 Cases + Operations.
- Oversight `inbox` / My Desk.

Known local junk to ignore unless the user explicitly asks otherwise:
- `.serena/`
- `bash.exe.stackdump`

Next recommended slice:
- `command` / Central Command dashboard, because it exercises the broadest
  operational rollups and consumes pins, recents, stale cases, task/signoff
  signals, trackers, and imports.

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
