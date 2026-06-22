# CID Portal — Session Handoff / Memory

> Read this first in a new chat. It captures architecture, what's built, what's live,
> the workflow, and the open backlog so work can continue without re-discovery.

## Project at a glance
- **App:** CID Portal — a Criminal Investigation Division ops tool for an SA-RP community ("State of San Andreas"). Cases, evidence, intel (persons/gangs/places), reports/forms, RICO, Drive, chat.
- **Stack:** Vanilla ES2017, **classic scripts sharing ONE global lexical scope** (no build step, no modules). Precompiled Tailwind in `styles.css`. Supabase backend with RLS.
- **Supabase project:** `cid` = `jhxuflzmqspidkvjckox` (org `nvxxnximnedwwzoxoceq`, **Free** plan). Other projects (leqat-platform, sahp-rbac) are unrelated/paused.
- **Repo:** GitHub `hamadalrumaihi/cid`. Production tracks **`main`** (Vercel); feature work lands on a `claude/*` branch → PR → merge to `main`. The most recent working branch was `claude/continue-previous-7pqwjg`.
- **Deployed:** `cidportal-ody.vercel.app` (Vercel builds `main`; PR previews build the branch).

## Critical architecture rules (don't break these)
- **Shared global scope:** every top-level `const`/`let`/`function` is global across all `*.js`. Names must be unique across files. **Verify every change two ways:**
  1. `node --check <file>` per changed file.
  2. Concatenate all `<script src>` files in `index.html` load order and `node --check` the concatenation (catches cross-file `const` collisions). One-liner:
     `files=$(grep -oE '<script src="[a-z0-9_]+\.js"></script>' index.html | sed -E 's/.*"([^"]+)".*/\1/'); :> /tmp/c.js; for f in $files; do cat "$f">>/tmp/c.js; echo>>/tmp/c.js; done; node --check /tmp/c.js`
- **Precompiled Tailwind:** classes not already used in the app may be **absent** from `styles.css` (e.g. `max-w-sm` was missing → broke a dialog). For new/uncommon utilities, prefer **inline `style=`** for critical layout (width/z-index), or reuse classes known to exist.
- **Migrations:** applied to live `cid` via the Supabase MCP `apply_migration`, **each user-approved first**. Keep the `.sql` in `supabase/migrations/`. After a DDL change, run `get_advisors` (security) and confirm only the by-design items remain.
- **RLS model:** `private.is_active()`, `private.is_command()` (bureau_lead/deputy_director/director), `private.can_delete()` (=command), `private.can_access_case()`, `private.can_create_case(bureau)`, `private.can_access_case_row(...)`. Function-grant gaps bite: policy functions must have EXECUTE for `authenticated`.
- **DB layer:** `DB().list(table,{eq,order,ascending,select})`, `DB().insert/update/remove`, `DB().from(table)` (raw supabase builder), `DB().rpc(fn,args)`. `DB().me` = profile; `canEdit()`=active, `canDelete()`/`isAdmin()`=command. `DB().list` **throws** on error (so `try/catch` detects a missing table).
- **Forms engine** (`drive.js` + `core.js FORM_SCHEMAS`): section types `kv|grid|textarea|note`; field types `text|select|textarea|date|money|checks`. Field flag `person:true` → autocomplete vs Persons (+ a known-properties hint). `REPORT_TEMPLATES` (persons.js) drives the per-case Reports tab launcher.
- **Reusable helpers worth knowing:** `toast(msg,type)`, `undoToast(msg,onUndo,ms)`, `deleteWithUndo(table,rows,{label,after})` (re-insert preserving id — leaf/SET-NULL deletes only), `uiConfirm`/`uiPrompt`, `copyText`, `openModal`/`closeModal`, `$`/`$$`/`el`, `openIntelProfile(type,id)`, `renderRicoInto(caseId,body,rerender)`.

## Case detail tabs (casefiles.js)
`overview · evidence · charges · rico · intel · reports · signoff · chat · timeline` — data-driven from one `tabs` array in `renderCaseDetailShell`; `loadDetailTab()` dispatches each.

## Shipped (cumulative — all merged to main)
- Waves 0–4: security; cases/sign-off; intel profiles + network graph; command scorecards + heatmap; branded exports + Drive search/versions.
- **Fillable forms:** Arrest/Search/Wiretap warrants, Subpoena, Surveillance Report (+ a `checks` checkbox field type).
- **Penal-code charges:** `penal.js` catalog → **Charges tab** per case (picker, stacking, totals incl. RICO predicates, keyword "Recommended", charge descriptions). Stored in `cases.charges` jsonb.
- **Full San Andreas Penal Code — Titles 1–10** (162 charges). Title 5/6 = firearm/drug charge tables; Title 10 = RICO modifiers. `modifier` flag → **MOD** chip; stacking keys off `stack` (modifiers get no stepper).
- **Reports:** name autocomplete vs Persons; suspect quick-fill chips; opt-in auto-add new persons; cross-reference other reports.
- **Media:** case Evidence "Linked Media" (upload/attach/detach); tags/labels with chips + vault filters.
- **Link intel directly to a case:** case **Intel tab** (link/unlink persons/gangs/places + kind/entity/role picker), bidirectional with the intel-profile "Linked cases" rollup. Table `case_intel_links`.
- **RICO per-case tab:** the RICO builder embedded in case detail via `renderRicoInto`; Charges "open RICO Builder" jumps to it in-place.
- **Player properties:** `persons.properties` jsonb — modal editor, card 🏠 chip, intel-profile section, properties hint under person-linked form fields.
- **Undo on delete:** `deleteWithUndo` + 6s Undo toast (re-insert preserving id). Wired into persons (single/modal/bulk), gang members, commendations.
- **QoL:** themed `uiConfirm`/`uiPrompt`; chat edit/delete; quick case status; copy buttons; bulk multi-select delete on Persons.

## Migrations applied to live `cid`
- Earlier: `cid_records_lock`, `wave0_advisor_followup`, `documents_versions`, `case_charges`, `case_messages_edit_delete`.
- This session: **`20260622120000_case_intel_links`** (polymorphic case↔intel join, RLS on `can_access_case`) · **`20260622130000_persons_properties`** (additive jsonb, inherits persons RLS) · **`20260622150000_cases_follow_up_at`** (additive date, inherits cases RLS).
- In-repo **not yet applied:** none pending.

## "Ease of mind" pass (claude/cid-rebuild — 9 commits, planned via 7-dimension AskUserQuestion)
20 enhancements built across 7 peace-of-mind dimensions. Shared layers in core.js: `Drafts` (namespaced localStorage), `Guard` + `requestCloseModal` + `beforeunload` (unsaved-changes), `setupConnectionWatch` + `withRetry` (resilience).
- **Never lose work:** form/report autosave + recovery banner, unsaved-changes guard, chat draft persistence, save-state feedback (drive.js/reports.js/collab.js).
- **Know where you stand:** the inbox leaf is now **My Desk** (sign-off + overdue + due follow-ups + needs-attention + mentions + draft reports), whose-court header hint, broadened My Desk badge.
- **Done right:** pre-sign-off completeness check (signoff.js), evidence integrity hints, report finalize validation (sensible-default required fields).
- **Low cognitive load:** **Cmd/Ctrl-K command palette** (app.js `openPalette`), deep search extended to Drive docs + charges, case breadcrumb.
- **Has your back:** pre-overdue aging chip, per-case follow-up dates, "Needs attention" nudges on My Desk.
- **Won't get in trouble:** audit-transparency note on the timeline, read-only chip + role-capabilities tooltip (auth.js).
- **Calm under pressure:** offline banner + auto-retry, friendlier load errors.
- **Skipped by owner:** server-side report autosave, always-on readiness card, personal audit view, optimistic-UI.
- **Sweeps completed:** D4·c empty-state CTAs (all actionable empty states now point to their add action) and D7·a silent-failure sweep (all primary per-tab/data loads surface friendly errors; best-effort/subscription paths left silent by design). Optional pre-overdue *notification* still deferred (visual indicator shipped).

## Workflow that's been working
- Build on a `claude/*` branch → commit per feature → push → owner opens/merges the PR to `main`. Production reflects `main`.
- Migrations: prep `.sql` in-repo, get the owner's approval, then `apply_migration` + advisor check. (This session the owner pre-approved applying, so both migrations went straight to live.)

## Open backlog (next chat: pick up here)
- ✅ Bulk multi-select delete — now on **Persons, Gangs, and Places** (command-gated `Set` + checkbox + sticky bar), all routed through `deleteWithUndo`.
- ✅ Undo-on-delete — `deleteWithUndo(table, rows, {label, after, children})`; `children:[{table,column}]` snapshots ON DELETE CASCADE rows and restores them on undo. Covers persons, gang members, commendations, gangs (+roster/ranks/turf), places (+process steps), evidence (+custody chain).
- ✅ Edit tags on existing media — `openMediaTagsEdit` from a 🏷️ button on the vault + case-media cards.
- ⬜ **True soft-delete** (cross-cutting): a `deleted_at` column + query filters so undo survives reloads and covers cascade parents without snapshotting. Touches RLS/SELECT on every table — **flag before doing**.
- ⬜ Small adds: undo on report/media-vault delete (verify report child table first).
- See `docs/BACKLOG.md` and `docs/DEFERRED.md` for the full lists + Pro-gated/network-blocked items (SheetJS repo-vendoring, server-side case filtering).

## Pre-pitch / known gaps (from the audit)
- Roster is tiny (Tom Wood = director/SAB + 1 detective). No bureau_lead/deputy or non-SAB users → can't demo the 3-tier sign-off live. **Seed a realistic roster before pitching.**
- Narcotics tab is empty; reports/chat/evidence are thin. Intel (persons/gangs/places) is rich.
- Leaked-password protection: a Supabase **Pro** feature — owner has opted not to enable it now.

_Last updated 2026-06-22 (penal Titles 5–10, intel↔case links, RICO per-case tab, player properties, undo-on-delete)._
