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
