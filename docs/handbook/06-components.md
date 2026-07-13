# Chapter 6 — Components Guide

[← Handbook index](README.md)

The reusable building blocks. **Reuse these instead of writing new ones** —
they encode hard-won behavior (focus management, dirty guards, injection
guards).

## `ui/Modal.tsx` — THE modal
- **Props**: `open, onClose, children, wide?, slide?, dismissible=true, dirty?()`
- **Behavior**: portal to body; focus trap + focus restore; Escape/backdrop
  route through `requestClose`, which shows a discard-confirm when
  `dirty()` is true; `beforeunload` guard; **ref-counted body scroll lock**
  (stacked modals safe); handlers routed through refs so its effect depends
  only on `[open]` — this exists because `AuthProvider` re-renders hourly
  on token refresh and would otherwise re-mount modal internals.
- **Reuse when**: any overlay. Pair with `ModalHeader`. Mount it fresh per
  edit session (state seeds from props — the repo never "resets" modals).

## `ui/dialog.tsx` — `uiConfirm` / `uiPrompt`
Promise-based themed replacements for `window.confirm/prompt` +
`DialogHost` (mounted in the app layout). Capture-phase keydown so dialog
keys beat an underlying modal's Escape. **Reuse when**: any confirmation
(danger-styled by default) or one-line input.

## `ui/Toaster.tsx` + `lib/toast.ts`
`toast(message, type)` from ANY code (zustand store — no React context
needed); every message passes `humanizeError` (Postgres/PostgREST errors →
human copy). `undoToast` powers the delete-undo pattern. **Reuse when**:
any feedback. Never `alert()`.

## `ui/DataTable.tsx`
Declarative columns (`value()` feeds sort/filter/CSV; optional `render()`,
`sortValue`, hidden `searchText`); pagination; CSV export guarded against
formula injection (`csvCell`, unit-tested). Currently used by AuditView.
**Reuse when**: any tabular list — don't hand-roll another table.

## `ui/RichEditor.tsx`
Tiptap v3, **markdown in / markdown out** — storage stays plain text so
`renderMarkdown`, exports, and the legacy app all still work. `value` is
initial-only; mount fresh per session. **Reuse when**: any long-text field
that renders as markdown elsewhere.

## The v1.14 shared set (extracted from the DOJ build)
Each of these was proven inside the legal-review UI and extracted once it
had two or more non-DOJ consumers. **Reuse them for any new adopter** —
don't re-inline the pattern.

- **`ui/WorkflowTimeline.tsx`** — the vertical actor/action/note history
  render. Used by: legal request History tab, case sign-off history
  (SignoffTab), evidence custody chain (EvidenceTab expandable), the
  Command Center approval-queue history, and the CID + Justice
  membership-request applicant history panels. **Reuse when**: any
  append-only history needs displaying.
- **`shared/RelatedRecordPicker.tsx`** — case-scoped record lookup/attach.
  Used by: legal exhibit pickers, the report editor's evidence lookup
  (ReportsTab FormEditor), RICO predicate-act evidence links (RicoTab).
- **`shared/VersionViewer.tsx`** — immutable version list + snapshot
  render. Used by: finalized report versions (ReportsTab "Versions" toggle
  over `report_versions`), the SOP history modal (SopsView).
- **`shared/SignatureViewer.tsx`** — signature trail render (supports
  superseded entries). Used by: legal version-bound signatures, report seal
  signatures incl. superseded seals from the reopen log (ReportsTab),
  tracker command co-signs (Trackers).
- **`ui/DeadlineChip.tsx` + `lib/deadlines.ts`** — the shared deadline
  engine (`lib/justice.ts`'s `deadlineInfo` now delegates to it). Used by:
  legal expiry/response deadlines, case-task due dates (TasksTab),
  joint-case access expiry (OverviewTab), case follow-ups (CaseDetail).
  **Reuse when**: any surface shows a due/expiry timestamp — same
  vocabulary everywhere.

## `cases/WatchButton.tsx`
Follow/unfollow for `case|person|vehicle`. Stops propagation (works inside
clickable cards). **Reuse when**: a record type becomes followable.

## `persons/IntelProfile.tsx`
The person/gang intel slide-over (roll-up + dossier export). Reused by
persons, BOLO, gangs, network. **Reuse when**: any screen needs "show me
everything about this subject".

## Shell components (see [Ch. 2](02-repository-tour.md))
Not usually reused directly, but their **hooks** are: `useNav()`
(navigate/activeTab), `useTableVersion(table)` (realtime),
`useAuth()` (identity/capabilities), `useProfilesStore`/`officerName`
(name resolution).

## Internal-to-feature components worth knowing
`CaseDetail` exports `RicoTab` (reused by `RicoView` — an internal
cross-import; if you split CaseDetail, keep that export working).
`GraphNode`/`TimelineBand`/`HeatSvg` are specialist SVG/graph pieces —
leaf nodes, safe to study, intricate to edit.
