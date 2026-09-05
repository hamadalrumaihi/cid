# UI review rules

Part 1 is a vendored copy of the Vercel Web Interface Guidelines
(`vercel-labs/web-interface-guidelines`, `command.md`, fetched 2026-09-05),
lightly trimmed to what applies to this Next.js 16 / React 19 / Tailwind v4
app. Part 2 is the CID Portal's own design system, which wins on conflict.

## Part 1 — Web Interface Guidelines

### Accessibility
- Icon-only buttons need `aria-label`.
- Form controls need `<label>` or `aria-label`.
- Interactive elements need keyboard handlers (`onKeyDown` / `onKeyUp`).
- `<button>` for actions, `<a>` / `<Link>` for navigation (never `<div onClick>`).
- Images need `alt` (or `alt=""` if decorative); decorative icons need `aria-hidden="true"`.
- Async updates (toasts, validation) need `aria-live="polite"`.
- Use semantic HTML (`<button>`, `<a>`, `<label>`, `<table>`) before ARIA.
- Headings hierarchical `<h1>`–`<h6>`; include a skip link to main content.
- `scroll-margin-top` on heading anchors.
- Meaningful media needs captions or descriptions; media controls need keyboard support.

### Focus states
- Interactive elements need visible focus (`:focus-visible` ring).
- Never `outline: none` / `outline-none` without a focus replacement.
- Prefer `:focus-visible` over `:focus`; group focus with `:focus-within` for compound controls.
- Sticky headers / footers / overlays must not cover the focused element.

### Forms
- Inputs need `autocomplete` and a meaningful `name`; correct `type` (`email`, `tel`, `url`, `number`) and `inputmode`.
- Never block paste.
- Labels clickable (`htmlFor` or wrapping control).
- `spellCheck={false}` on emails, codes, usernames, identifiers.
- Checkboxes / radios: label and control share one hit target.
- Submit stays enabled until the request starts; spinner during the request.
- Errors inline next to fields; focus the first error on submit.
- Placeholders end with `…` and show an example pattern.
- `autocomplete="off"` on non-auth fields to avoid password-manager triggers.
- Warn before navigation with unsaved changes (`beforeunload` or router guard) — only while a flush is pending (portal rule CW9).

### Animation
- Honor `prefers-reduced-motion`.
- Animate `transform` / `opacity` only; never `transition: all`.
- Set the correct `transform-origin`; SVG transforms on a `<g>` wrapper with `transform-box: fill-box`.
- Animations interruptible; autoplay motion > 5 s needs pause / stop controls.

### Typography
- `…` not `...`; curly quotes; non-breaking spaces in `10&nbsp;MB`, `⌘&nbsp;K`, brand names.
- Loading states end with `…` ("Saving…").
- `font-variant-numeric: tabular-nums` for number columns.
- `text-wrap: balance` / `text-pretty` on headings.

### Content handling
- Text containers handle long content (`truncate`, `line-clamp-*`, `break-words`); flex children need `min-w-0`.
- Handle empty states — never render broken UI for empty strings / arrays.
- User-generated content: anticipate short, average and very long inputs.

### Images
- `<img>` needs explicit `width` and `height`; below-fold images `loading="lazy"`; above-fold critical images `fetchpriority="high"`.

### Performance
- Large lists (> 50 items): virtualize or `content-visibility: auto`.
- No layout reads in render (`getBoundingClientRect`, `offsetHeight`, `scrollTop`); batch DOM reads / writes.
- Prefer uncontrolled inputs; controlled inputs must be cheap per keystroke.
- `<link rel="preconnect">` for asset domains; preload critical fonts with `font-display: swap`.
- Prefer muted looping video over animated GIF.

### Navigation & state
- URL reflects state — filters, tabs, pagination, expanded panels in query params.
- Links use `<a>` / `<Link>` (Cmd/Ctrl-click, middle-click).
- Deep-link all stateful UI.
- Destructive actions need a confirmation or an undo window — never immediate.

### Touch & interaction
- `touch-action: manipulation` on tappable controls; set `-webkit-tap-highlight-color` intentionally.
- `overscroll-behavior: contain` in modals / drawers / sheets.
- During drag: disable text selection, `inert` on dragged elements.
- Gestures need tap / click and keyboard alternatives.
- `autoFocus` sparingly — desktop only, single primary input.

### Safe areas & layout
- Full-bleed layouts use `env(safe-area-inset-*)`.
- Avoid unwanted scrollbars; wide content scrolls inside its own container.
- Flex / grid over JS measurement.

### Dark mode & theming
- `color-scheme: dark` on the root for dark themes; `<meta name="theme-color">` matches the page background.
- Native `<select>`: explicit `background-color` and `color`.

### Locale & i18n
- Dates / times via `Intl.DateTimeFormat`; numbers / currency via `Intl.NumberFormat`.
- Identifiers, code tokens and brand names wrapped with `translate="no"`.

### Hydration safety
- Inputs with `value` need `onChange` (or `defaultValue`); guard date / time rendering against hydration mismatch; `suppressHydrationWarning` only where needed.

### Hover & interactive states
- Buttons / links need a `hover:` state; hover / active / focus more prominent than rest.

### Content & copy
- Active voice; second person; specific button labels ("Seal report", not "Continue").
- Numerals for counts ("8 cases"); error messages include the fix.
- `&` over "and" where space-constrained.

### Anti-patterns (always flag)
- `user-scalable=no` / `maximum-scale=1`; `onPaste` + `preventDefault`; `transition: all`; `outline-none` without a `:focus-visible` replacement; inline `onClick` navigation without `<a>`; `<div>` / `<span>` with click handlers; images without dimensions; large `.map()` without virtualization; inputs without labels; icon buttons without `aria-label`; hardcoded date / number formats; unjustified `autoFocus`; animated GIF where video fits; gesture-only actions.

## Part 2 — CID Portal design system (wins on conflict)

Source: `DESIGN.md` (root) and `docs/DESIGN-SYSTEM.md`.

- Dark-only. Canvas `#070b14`; surfaces from the token ladder; hairlines (`white/7`, `white/14`) instead of shadows; `shadow-pop` only on floating chrome.
- One accent (user-selectable, amber default) for interactive emphasis; violet reserved for SIB; status colors only through `StatusBadge` / `lib/status`.
- Inter for UI, JetBrains Mono for identifiers and readouts; no `font-black`; uppercase + tracking only for semantic codes.
- Radius: `rounded` chips, `rounded-lg` surfaces and controls, `rounded-xl` modals only, `rounded-full` dots / avatars / segmented switchers.
- Nothing glows, pulses or gradients; no background textures, staggered entrances, emoji as UI, or icons inside colored squares.
- One of everything: `DataTable` for lists, `SectionTabs` underline tabs, `Badge` geometry, `EmptyState` / `Skeleton` / `ErrorNotice` idioms.
- A fetch error never renders as an empty state.
- Absence is the permission answer: no counts, hints or "N hidden" placeholders for sealed, SIB-restricted or restricted material.
- Every screen needs a way back; every list needs its empty state; every mutation surfaces its failure (toast) and its success state.
- Z-index from the `--z-*` scale in `globals.css`; no ad-hoc values.
- Touch floor 44 px below `lg`; `useNarrow()` is the single JS breakpoint signal.
- Six keyframes total, all ≤ 300 ms, all disabled under reduced motion; a new animation requires a written reason.
- Dates and counts through `src/lib/format.ts`.
