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

## WAVE 0 — Security & foundation ⚠️ NEARLY DONE (1 blocked)
- ✅ Pin supabase-js to an exact latest-stable 2.x — pinned to `2.108.2` in index.html.
- ⛔ **BLOCKED:** xlsx — self-host the CURRENT patched SheetJS. cdn.sheetjs.com / jsdelivr / unpkg / git.sheetjs.com are all denied by this environment's network policy, and GitHub's mirror is frozen at the still-vulnerable 0.18.12. User opted to allow-list cdn.sheetjs.com; pending the policy update taking effect (may need a fresh session), then: fetch 0.20.x → vendor into repo → point index.html at the local copy. Still on vulnerable `0.18.5` CDN meanwhile. Do NOT vendor 0.18.5/0.18.12.
- ✅ Supabase advisors run + remediated (this pass), applied to live `cid`:
    - `cid_records_lock` (the never-applied migration, see below) — anon SELECT closed; read now gated on `private.is_active()`; owner/command update; command-only delete.
    - `20260619020000_wave0_advisor_followup` — re-pinned `private.touch_cases` search_path; dropped duplicate `cases_case_number_uniq` index.
    - Re-ran both advisors: `function_search_path_mutable`, `auth_rls_initplan` (cid_records), and `duplicate_index` (cases) all CLEARED.
    - Left by design / deferred: 6 server-authoritative SECURITY DEFINER RPCs (intentional); leaked-password protection (Auth dashboard toggle — recommend enabling); 63 unindexed-FK INFO lints → Wave 3's query-verified index pass; 2 unused-index INFO lints (recently-added, leave); 3 `multiple_permissive_policies` on announcements/profiles (intentional layered RLS — escalate before consolidating).
- ✅ **(Was CRITICAL)** `cid_records_lock` had been committed (25680d7) but never applied to live `cid` — fixed this pass by applying it. NOTE: applied via MCP under a fresh version, so `supabase db push` may re-run the repo file `20260618120000_cid_records_lock.sql`; it is idempotent (drop-if-exists + recreate).
- ✅ Reconcile Live Records: `records.js` on the MAIN client (`25680d7`) + DB lock now applied.

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
