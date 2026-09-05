# DESIGN.md — CID Portal

> The design contract for agents and contributors building UI in this repo, in
> the DESIGN.md convention. It distils `docs/DESIGN-SYSTEM.md`, which remains
> the full reference; where the two disagree, the reference wins. Tokens live in
> `src/app/globals.css` (`@theme`), primitives in `src/components/ui/`, icons in
> `src/components/shell/icons.tsx`.

## Overview

The CID Portal is a case-management and criminal-intelligence workstation for
a roleplay police division. Detectives live in it for hours: dense registries,
case files, legal paper, queues. The visual language is a **dark, information-
first, tactical** system — hairlines instead of shadows, one amber accent,
identifiers in monospace, nothing decorative. It is **dark-only by design**;
there is no light theme to maintain.

**Key characteristics**
- Deep blue-black canvas (`#070b14`) with a four-step surface ladder; structure
  comes from 1px hairlines, not elevation.
- One chromatic accent (user-selectable, amber by default) spent on interactive
  emphasis only. Violet is **reserved** for Special Investigations Bureau (SIB)
  context and is never decorative.
- Inter for the interface, JetBrains Mono for every identifier and readout
  (case numbers, plates, request numbers, counts).
- Nothing glows, pulses, or gradients. No background textures, no staggered
  entrances, no icons inside colored squares, no emoji as UI.
- One of everything: one radius scale, one badge geometry, one tab style, one
  table component, one empty/loading/error idiom.

## Colors

Semantic tokens; the legacy `ink-*` ramp and `blue-*`/`badge-*` accent remap
remain valid for existing code, but new and refactored code writes against
these.

### Surface
- **Canvas** (`canvas`, `#070b14`): page background.
- **Surface** (`surface`, `#0b1220`): panels, tables, inputs.
- **Surface raised** (`surface-raised`, `#0f1726`): menus, popovers, modals.
- **Surface overlay** (`surface-overlay`, `#131c2e`): highest chrome.
- **Edge** (`edge`, `white/7`): quiet hairline.
- **Edge strong** (`edge-strong`, `white/14`): structural border, inputs.

### Text
- **Foreground** (`fg`, `#e6eaf2`): primary text.
- **Foreground mid** (`fg-mid`, `#94a3b8`): secondary text.
- **Foreground muted** (`fg-muted`, `#64748b`): metadata, labels.

### Accent & semantic
- **Accent** (`accent`): the user's chosen accent via the `data-accent` remap;
  amber by default. Interactive emphasis, focus rings, active tab underline,
  active nav rail.
- **SIB violet**: reserved for SIB surfaces and markings only.
- **Status tones**: come from `src/lib/status.ts` / `src/lib/tint.ts` through
  `StatusBadge`; never hand-picked per screen. The label always renders —
  color is never the only signal.
- **Elevation shadow** (`shadow-pop`, `0 8px 24px black/45`): the only shadow,
  and only on floating chrome (menus, popovers, dialogs).

## Typography

- **UI face**: Inter (system sans fallback). **Data face**: JetBrains Mono
  (`font-mono`) for identifiers, codes, tabular readouts.
- Page title: `text-xl font-semibold tracking-tight text-white`.
- Section title: `text-base font-semibold tracking-tight text-white`.
- Subsection heading: `text-[13px] font-semibold text-white`, sentence case.
- Body: `text-sm text-slate-200/300`; secondary body `text-sm text-slate-400`.
- Metadata label: `text-xs font-medium text-slate-500`, sentence case; value
  `text-xs text-slate-400`.
- Rules: `font-black` does not exist. Uppercase + letter-spacing is reserved
  for **semantic codes** (case numbers, bureau codes, classification
  markings), never for section labels. Hierarchy comes from size, weight and
  muting. Numbers in columns use `tabular-nums`.

## Layout

- Fixed top bar (`h-14`, `--app-header-h: 3.5rem`) with breadcrumb context,
  global search (`/` focus, `⌘K` palette), create menu, notifications, account.
- Grouped sidebar with a 2px accent rail on the active item; collapsible rail
  with flyout labels; becomes a drawer below `lg`.
- The page `<h1>` lives in the view (`PageHeader`), unboxed on the canvas —
  never inside a hero card.
- Content is dense where the work is dense and quiet everywhere else.
  Typography, dividers, alignment and spacing structure a screen before any
  container does.
- Registry and list data renders in `ui/DataTable` (sorting, filtering,
  selection, CSV, `mobileCard` fallback). Cards are for genuinely visual or
  heterogeneous content, never the default.
- Wide content (tables, code, diagrams) scrolls inside its own container; the
  page never scrolls horizontally.

## Elevation & depth

- Hairlines over shadows. `edge` for quiet separation, `edge-strong` for
  structural borders and inputs.
- `shadow-pop` only on floating chrome. Panels, cards and tables have no
  shadow.
- A `Card` is for a genuine surface — a record, a form, a table — never a
  wrapper for a heading or a single number.

## Shapes

- `rounded` (4px): chips, kbd.
- `rounded-lg` (8px): every surface and control.
- `rounded-xl` (12px): modal tier only (`Modal`, `dialog`).
- `rounded-full`: dots, avatars, segmented switchers only.
- Nothing else.

## Components

Compose from `src/components/ui/`: `Button`, `Field` (+ `Input` / `Select` /
`Textarea`), `Modal` (+ `ModalHeader`), `dialog` (`uiConfirm` / `uiPrompt`),
`DataTable`, `SectionTabs`, `Badge` / `StatusBadge` / `AccessBadge` /
`IntelBadges`, `Notice` (`EmptyState`, `ErrorNotice`), `Skeleton` family,
`PageHeader`, `Breadcrumbs`, `MetricStrip`, `DeadlineChip`, `EntityLink`,
`RecordPeek`, `RichEditor`, `SaveState`, `WorkflowTimeline`, `ActionMenu`,
`HelpTip`, `Toaster`.

- **Buttons**: one component, variants by role (`primary`, `ghost`, `danger`).
  Specific labels ("Seal report", "Grant access"), never "Continue".
- **Tabs**: underline tabs — active = white text + 2px accent underline on a
  hairline baseline; inactive = muted. No filled pills.
- **Badges**: `rounded px-2 py-0.5 text-[11px] font-semibold`; tones from the
  status registry; counts use the same geometry with `tabular-nums`.
- **Icons**: the local 24×24 single-path stroke set, `currentColor`, 1.6
  weight, 14–20px next to labels.
- **States**: `EmptyState` says what this is, why it is empty, what to do;
  `Skeleton` shapes match the content; `ErrorNotice` humanizes the message and
  offers Retry. A fetch error must never read as an empty state.
- **Drafts**: autosave through `lib/userDrafts` with `SaveState` feedback.

## Do's and Don'ts

**Do**
- Reuse a primitive before writing markup; copy the nearest existing pattern.
- Keep permissions, RLS, workflows, focus management and touch targets
  untouched during visual work.
- Give every interactive element a visible `:focus-visible` ring in the accent.
- Keep the 44px touch floor below `lg`; honor `prefers-reduced-motion`.
- Render absence for material the viewer may not see — never counts, hints,
  or "N hidden" placeholders for sealed, SIB-restricted or restricted records.

**Don't**
- Gradients, glows, breathing dots, staggered entrances, background textures.
- Hand-picked badge colors, ad-hoc radii, a second accent hue.
- Uppercase section labels; `font-black`; emoji as interface elements.
- Cards as wrappers for headings or single numbers; grids because they are
  easy.
- New client-side dependencies for visuals; animations without a written
  reason.

## Responsive behavior

- Breakpoints: Tailwind defaults; `useNarrow()` (`max-width: 639px`) is the
  single JS signal for layout branches — never CSS hiding of duplicate DOM.
- Sidebar becomes a drawer below `lg`; workspace tab strips collapse to the
  active tab plus an "Open tabs" menu on narrow viewports; case sections switch
  through a bottom-sheet switcher below `sm`.
- Tables fall back to `mobileCard`; primary actions sit in `StickyActionBar`
  above the bottom nav with safe-area insets.

## Motion

Six keyframes total (view fade-up, modal pop, backdrop fade, skeleton pulse,
spinner), all ≤300ms, all disabled under `prefers-reduced-motion`. Motion
communicates state change; it never decorates.

## Iteration guide

Restyle by composing tokens and primitives; extend the system in
`docs/DESIGN-SYSTEM.md` first, then in `ui/`, then in views. Run the
`ui-review` project skill (`.claude/skills/ui-review/`) against changed
components before opening a UI pull request.
