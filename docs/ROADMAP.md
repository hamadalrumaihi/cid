# CID Portal — Build Spec (claude/cid-rebuild) · v2

> Source of truth for the wave roadmap. Shipped work is also recorded in `CHANGELOG.md` (as Phases). Keep this in sync as waves land.

## Ground rules
- Branch: `claude/cid-rebuild` · commit per feature · NO PR/merge/deploy until explicitly asked.
- Migrations: applied directly via Supabase tooling, each shown before applying; `.sql` kept in-repo.
- Validation: read-only queries + Supabase advisors (fix what they flag); NO test writes to live DB; `node --check` on JS.
- Advisor findings: apply mechanical/low-risk fixes directly. If an advisor flags something needing a DESIGN decision — e.g. a change to a bureau-isolation or other RLS policy — STOP and ask. Never silently rewrite an isolation policy to satisfy an advisor.
- Notifications: in-app only (Discord DMs deferred).
- Refactors: opportunistic only, within files already touched (role-label consolidation NOT done proactively).
- Preserve the dark theme and all working logic. Respect server-authoritative sign-off triggers + bureau-isolation RLS.
- Build order: Wave 0 → Cases → Intel → Command → Reports.

## WAVE 0 — Security & foundation ⚠️ PARTIAL
- ✅ Pin supabase-js to an exact latest-stable 2.x — pinned to `2.108.2` in index.html.
- ⛔ **BLOCKED:** xlsx — self-host the CURRENT patched SheetJS. cdn.sheetjs.com / jsdelivr / unpkg / git.sheetjs.com are all blocked by this environment's network policy, and GitHub's mirror is frozen at the still-vulnerable 0.18.12. Needs the host allow-listed OR the `xlsx.full.min.js` file supplied. Still on vulnerable `0.18.5` CDN meanwhile. Do NOT vendor 0.18.5/0.18.12. Keep full import/export.
- ⏳ Supabase advisors run (this pass). Mechanical fixes prepared in `20260619020000_wave0_advisor_followup.sql` (touch_cases search_path + drop duplicate cases index) — **awaiting approval to apply to live `cid` project**. By-design/escalated items documented in commit message + below.
- ⚠️ **CRITICAL — found this pass:** `20260618120000_cid_records_lock.sql` was committed (25680d7) and marked ✅ below, but the applied-migration history shows it was **never applied to the live `cid` project**. Live `cid_records` still has anon SELECT + un-hardened owner policies. The existing lock migration needs applying (fixes anon-read, is_active gating, and the auth_rls_initplan lint in one shot).
- ⚠️ Reconcile Live Records: `records.js` routed through the MAIN client — `25680d7` (code shipped; **DB lock migration still unapplied — see above**).

## WAVE 1 — Cases & sign-off ✅
- **Sign-off inbox**: Oversight sub-tab + count badge on Command. Cases awaiting my decision (reviewer), cases I submitted in-flight, cases bounced back to me (changes_requested/denied). Overdue pinned to top with age. — `1d55606`
- **Quick-create templates**: seeded, command-editable table. Presets: Narcotics Raid, Homicide/Violent, Gang/RICO, Property/Theft, Blank. Bureau-lead+ edit. [migration] — `5ec9b6e`
- **Auto-escalate stale cases**: client-side on app load, 14-day threshold. Notify assignee + command, visual overdue flag, pin in sign-off inbox. No auto-routing. Lazy (fires on app open), not scheduled — accepted tradeoff; scheduled fn is future upgrade. — `3d5ef71`

## WAVE 2 — Intelligence  ← CURRENT
- ✅ **Cross-intel global search**: extend existing global search to persons, gangs, places, narcotics, ballistics, and cases; typed, clickable results. — `8bc44a8`
- ✅ **Unified intel profiles**: slide-over panel from any person/gang card, rolling up linked cases, media, evidence, gang members, and places. — `d97f216`
- ✅ **Bulk CSV import**: existing per-module importer (CSV/JSON/XLSX) extended with downloadable per-entity CSV templates, skip-duplicates-by-name (vs. existing rows + within the batch), and a breakdown import summary (imported · duplicates · invalid). Gang rosters bulk-import per-gang from the gang detail (`#member-new`), deduped by name within the gang.
- ✅ **Relationship graph**: hand-rolled SVG (no new dependency) on the Intelligence "Network" sub-tab — gangs as hubs, members/places orbiting; ego/overview layouts, drag-pan, wheel/+/− zoom, click-to-recentre, click-centre to open the intel profile. Also openable centred on a person/gang via `openIntelGraph()` (🕸 button on the intel profile slide-over). Scope: persons/gangs/places relationships (cases deferred — kept the layout clean per the timebox).
- _No migration for Wave 2._

**WAVE 2 COMPLETE** ✅ — all four items shipped.

## WAVE 3 — Command & Heatmap
- **Server-side filtering**: move status/bureau/lead/sign-off/text filters into Supabase queries; load-more / infinite scroll at 50/page. [migration: indexes on bureau, status, lead_detective_id, signoff_status, created_at — verified against the queries]
- **Heatmap upgrades**: enhanced AREA-based (no geo map); time-range slider on `created_at`; toggleable layers (cases / gang turf / places / raids) + intensity.
- **Bureau scorecards**: open/active load, clearance rate, avg time-to-close. Command sees all bureaus; a bureau lead sees their own.

## WAVE 4 — Reports & Drive
- **Branded export**: text letterhead ("Criminal Investigation Division — State of San Andreas") with image slot for a logo/seal (supplied later); "LAW ENFORCEMENT SENSITIVE" banner; applies to .pdf (jsPDF) and .docx (docx.js).
- **Drive search & versions**: search by name/folder/content; new `documents_versions` table keeping ALL versions with restore-any. [migration]

## Migrations summary
1. `cid_records` RLS lock + records.js client switch (one commit) — Wave 0 ✅
2. `case_templates` table (command-editable) — Wave 1 ✅
3. case-list indexes (bureau, status, lead_detective_id, signoff_status, created_at) — Wave 3
4. `documents_versions` table — Wave 4

_Auto-escalate uses the existing `notifications` table — no new table._

## Open asset dependency (non-blocking)
- Logo/seal image for export letterhead — send whenever; text letterhead ships without it.
