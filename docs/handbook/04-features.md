# Chapter 4 — Feature Guide

[← Handbook index](README.md)

Every major feature, with its complete data flow. File-level detail lives
in the [File Index](appendix-file-index.md); table/RPC details in
[Ch. 8](08-database.md).

## 4.1 The case lifecycle (flagship)

**Purpose**: the central investigation record. **Permissions**: bureau-
scoped (`can_access_case`); deletes command-only.

1. **Create** — `CasesView` "+ New Case" (or ⌘K "new case", or the ticket
   wizard) → `CaseModal`: template chips prefill fields + a task
   checklist; `insert('cases')` with `case_number = BUREAU-digits`;
   checklist rows → `insert('case_tasks')`.
2. **Work it** — `CaseDetail`'s 12 tabs (Overview, Graph, Evidence, Notes,
   Charges, RICO, Intel, Reports, Tasks, Sign-off, Chat, Timeline) each
   fetch and write their own case-scoped tables. Custody transfers append
   to the immutable `custody_chain`.
3. **Move it** — drag on the board → `update('cases', {status})`; triggers
   stamp `closed_at`/`updated_at`.
4. **Stale escalation (automatic)** — once per session, `CasesView` finds
   open/active cases quiet ≥14 days, claims them with a compare-and-swap
   (`updateWhere … last_stale_notified_at is null`) and notifies
   lead/bureau-leads/deputy. The CAS prevents two open tabs double-firing.
5. **Sign-off** — `rpc('signoff_submit')` → SQL picks the stage + a
   non-LOA assignee → reviewer `rpc('signoff_decide')`, owner
   `rpc('signoff_owner_action')`. History rows + notifications are written
   inside the RPCs. Direct column writes are trigger-blocked.
6. **Export** — the packet button gathers everything
   (`lib/packet.gatherCasePacket`, partial-tolerant) and renders PDF
   (dynamic-imported `lib/pdf`), DOCX (`lib/docx`), or Markdown.
7. **Delete** — `deleteWithUndo` with cascade config; Undo restores
   parents + children with original ids.

**Data flow**: user action → `db.ts` helper → PostgREST → RLS check →
row change → realtime event → version bump → every subscribed view
refetches → UI updates (including other users' browsers).

## 4.2 Intelligence registries

Persons, gangs (ranks/members/turf), vehicles, places, narcotics,
ballistics, media vault, records, BOLO board — all one uniform pattern
(fetch + version counter, `?q=` seeded filter, card grid, modal CRUD,
canEdit/canDelete gates, `deleteWithUndo`). Shared RLS: any active member
reads/writes, command deletes. The `IntelProfile` slide-over
(persons/gangs) rolls up everything linked to a subject and exports
dossiers.

## 4.3 Deconfliction (three systems)

- **Indicators registry** (server data): hard identifiers per case; a
  normalized `matchKey` (separators stripped for phone/account/serial)
  matching across ≥2 cases raises a ⚡ alert. Matches into cases you can't
  see render as 🔒 restricted stubs — value visible, case hidden.
- **Vehicles scanner** (client heuristics): phones/plates/persons across
  ≥2 visible cases from report text + intel links. A failed scan shows
  Retry — never a false "no matches".
- **M.O. crossref** (RPC): existence-only matches into other bureaus'
  cases with a request-access flow — a *deliberate, controlled* leak.

## 4.4 Global search & commands (⌘K)

`Header` shortcut → `SearchPalette` → debounced `runSearch` → `search_all`
RPC (pg_trgm fuzzy, RLS-scoped, SECURITY INVOKER) + static penal-code
hits + quick actions (New case, LOA, sign out, go-to-tab). A sequence
guard drops out-of-order responses. Enter deep-links (`?case=`, `?q=`,
and since v1.14 `/legal?request=` for legal-request hits). v1.14 added a
`legal` kind to `search_all`: header fields only, and because the function
is SECURITY INVOKER every hit passes the `legal_requests` SELECT policy —
sealed requests never surface.

## 4.5 Command tools

Dashboard (KPIs + 8 widgets incl. the ticket wizard that *creates cases*
and the dual-co-sign GPS trackers — self-co-sign blocked in UI *and* by
trigger), division analytics (SVG charts, Monday-week buckets),
announcements (audience-targeted: everyone/`@everyone` for deputy+ only,
command, own/specific department, or just the mentioned members — the
`publish_announcement()` RPC resolves recipients server-side with one
notification each, a recipient-count preview and confirm in the composer,
and edits never re-notify unless explicitly requested), heatmap
(weighted layers, pan/zoom SVG map), roster (membership requests: new
sign-ins request ONE permanent department — LSB/BCB/SAB, never JTF — plus
a rank-and-file role from the inactive-account screen; the Approval Queue
reviews them via `review_membership_request()` — approve /
approve-with-changes / request-correction / reject — activating the
profile only on approval; the legacy one-click `assign_member` approve
remains for requestless profiles). Joint cases:
`convert_case_to_joint()` tags a case JTF while preserving its
originating bureau and grants selected members temporary case-scoped
access (joint roles, optional expiry, removable, endable) — access model
in Ch. 8.

## 4.6 Personal tools

My Desk (ten derived panels over eight live tables), watchlist (follow +
"updated" chips via localStorage seen-stamps), calendar (follow-ups, task
due dates, report weeks), shift reports (one per week enforced by unique
key, auto-rollup), notifications bell.

## 4.7 Reference & exports

Penal code (static data + calculators), SOPs & library (version snapshot
BEFORE every overwrite; command-write-only folders), the visual user
guide, court packet/dossier exports, audit-log CSV export
(formula-injection-guarded).
