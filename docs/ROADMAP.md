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
- ❌ **OUTSTANDING:** Pin supabase-js to an exact latest-stable 2.x (still floating `@2` in index.html:558).
- ❌ **OUTSTANDING:** xlsx — self-host the CURRENT patched SheetJS from cdn.sheetjs.com (still on vulnerable npm `0.18.5` CDN at index.html:562; do NOT vendor 0.18.5). Keep full import/export. jsPDF + fonts stay on CDN.
- ⏳ Run Supabase security + performance advisors; fix mechanical issues, escalate design-level ones. _(not yet re-run this pass)_
- ✅ Reconcile Live Records: `cid_records` locked behind auth + `records.js` routed through the MAIN client — `25680d7`.

## WAVE 1 — Cases & sign-off ✅
- **Sign-off inbox**: Oversight sub-tab + count badge on Command. Cases awaiting my decision (reviewer), cases I submitted in-flight, cases bounced back to me (changes_requested/denied). Overdue pinned to top with age. — `1d55606`
- **Quick-create templates**: seeded, command-editable table. Presets: Narcotics Raid, Homicide/Violent, Gang/RICO, Property/Theft, Blank. Bureau-lead+ edit. [migration] — `5ec9b6e`
- **Auto-escalate stale cases**: client-side on app load, 14-day threshold. Notify assignee + command, visual overdue flag, pin in sign-off inbox. No auto-routing. Lazy (fires on app open), not scheduled — accepted tradeoff; scheduled fn is future upgrade. — `3d5ef71`

## WAVE 2 — Intelligence  ← CURRENT
- **Cross-intel global search**: extend existing global search to persons, gangs, places, narcotics, ballistics, and cases; typed, clickable results.
- **Unified intel profiles**: slide-over panel from any person/gang card, rolling up linked cases, media, evidence, gang members, and places.
- **Relationship graph**: in-house SVG (no new dependency) on a new Intelligence "Network" sub-tab, also openable centered on a person/gang; pan/zoom/click-through. **TIMEBOX — lowest priority**; if hand-rolled layout/pan-zoom gets disproportionately fiddly, fall back to the simple linked-tree view or defer.
- **Bulk CSV import**: Persons, Gangs+members, Places, Narcotics. Per-entity CSV templates; skip duplicates by name with an import summary.
- _No migration for Wave 2._

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
