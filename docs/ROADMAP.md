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
- ✅ xlsx — upgraded 0.18.5 → **0.20.3** off the official `cdn.sheetjs.com` (PR #30, merged to main then merged into cid-rebuild `1e25ece`). Resolves CVE-2023-30533 + the ReDoS. NOTE: this is a version-pinned vendor-CDN reference, not a repo-vendored self-host — the CVEs are resolved either way; vendoring into the repo remains an optional future hardening if you want to drop the external dependency entirely.
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

## WAVE 3 — Command & Heatmap  ← CURRENT
> Sequencing note (Free tier): `casesCache` is a load-bearing full-load cache (KPIs, bureau load, heatmap, Drive folders, every case dropdown, id→number lookups read it). At this app's scale, full server-side pagination is a high-risk/low-payoff refactor that fights that architecture — so the additive wins (scorecards, heatmap) go first, and server-side filtering is reconsidered/deferred unless data volume actually demands it.
- ✅ **Bureau scorecards**: per-bureau active load, clearance rate, avg time-to-close on the Command dashboard. Director/deputy see all four bureaus; a bureau lead sees only their own. Computed from the RLS-scoped `casesCache` (no migration). — this pass
- ✅ **Heatmap upgrades**: AREA-based intensity now has toggleable layers (cases / raids / turf / places) that re-weight the score live, and a `created_at` time-range slider (all-time / year / 90d / 30d / 7d). Per-tile breakdown + legend reflect the active layers and window. Untimestamped standing intel stays in-range. — this pass
- **Server-side filtering** (RECONSIDERED — likely defer): move status/bureau/lead/sign-off/text filters into Supabase queries; load-more / infinite scroll at 50/page. Only worth it once case volume is large enough to feel the client-side filter; would need a slim-projection cache for the cross-cutting consumers + lean indexes (bureau, status, lead_detective_id, signoff_status, created_at — verified against queries). Not started.

## WAVE 4 — Reports & Drive  ← CURRENT
- ✅ **Branded export**: shared agency letterhead (Criminal Investigation Division · State of San Andreas) + "LAW ENFORCEMENT SENSITIVE" banner on every PDF (`pdfLetterhead`) and .docx (`brandParas`, auto-prepended in `downloadDocx`) — covers report exports, case packets, and RICO summaries. Centralized in `docx.js` with a `LETTERHEAD.logoDataUrl` image slot (PDF renders a supplied seal via `addImage`; DOCX image embedding is a future step). — this pass
- ✅ **Drive search**: search box on the CID General drive matching a document's name, folder, linked case number, and content (body / sheet cells / form values) across the RLS-scoped DOCS cache; results click through to the file. Client-side, no migration. — this pass
- 🟡 **Drive versions**: `documents_versions` append-only history (migration `20260620120000_documents_versions.sql`). Client wired — every save snapshots; a 🕘 History view per doc/sheet/form lists versions (time + author) with restore-any. Code is defensive (no-ops if the table is absent). **Migration NOT yet applied to live `cid` — awaiting approval.**

> Deferred/blocked items (SheetJS vendoring, server-side filtering, Pro-gated hardening) are tracked in `DEFERRED.md`.

## Migrations summary
1. `cid_records` RLS lock + records.js client switch (one commit) — Wave 0 ✅
2. `case_templates` table (command-editable) — Wave 1 ✅
3. case-list indexes (bureau, status, lead_detective_id, signoff_status, created_at) — Wave 3
4. `documents_versions` table — Wave 4

_Auto-escalate uses the existing `notifications` table — no new table._

## Open asset dependency (non-blocking)
- Logo/seal image for export letterhead — send whenever; text letterhead ships without it.
