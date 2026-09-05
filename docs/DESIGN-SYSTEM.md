# CID Portal design system

The portal's visual language, defined once. Every screen composes these rules;
no view invents its own. The goal is a mature, information-first product —
dense where the work is dense, quiet everywhere else. Dark-only by design.

## Principles

1. **Information is the interface.** Typography, dividers, alignment and
   spacing structure a screen before any container does. A panel (`Card`) is
   for a genuine surface — a record, a form, a table — never a wrapper for a
   heading or a single number.
2. **Hairlines over shadows.** Structure comes from 1px `white/7`–`white/14`
   borders on solid surfaces. Elevation shadows exist only on floating chrome
   (menus, popovers, dialogs).
3. **Nothing glows, nothing pulses, nothing gradients.** Decoration that
   signals "generated" is banned: gradient fills, glow shadows, breathing
   dots, staggered entrances, background textures.
4. **One of everything.** One radius scale, one badge geometry, one icon set,
   one tab style, one table component, one empty/loading/error idiom.
5. **Never restyle at the cost of behavior.** Permissions, RLS, workflows,
   focus management and touch targets are untouchable during visual work.

## Tokens (`src/app/globals.css` `@theme`)

| Token | Value | Use |
|---|---|---|
| `canvas` | `#070b14` | Page background |
| `surface` | `#0b1220` | Panels, tables, inputs |
| `surface-raised` | `#0f1726` | Menus, popovers, modals |
| `surface-overlay` | `#131c2e` | Highest chrome |
| `edge` | `white/7` | Quiet hairline |
| `edge-strong` | `white/14` | Structural border, inputs |
| `fg` / `fg-mid` / `fg-muted` | `#e6eaf2` / `#94a3b8` / `#64748b` | Text roles |
| `accent` | user accent (amber default) | Interactive emphasis — via the `data-accent` remap |
| `shadow-pop` | `0 8px 24px black/45` | The only elevation shadow |

The legacy `ink-*` ramp and the `blue-*`/`badge-*` accent remap remain valid —
the semantic tier is what new and refactored code writes against. Violet is
**reserved** for SIB context and is never decorative.

## Typography

Inter (UI) + JetBrains Mono (identifiers, readouts). The scale:

| Role | Recipe |
|---|---|
| Page title (`PageHeader` h1) | `text-xl font-semibold tracking-tight text-white` |
| Section title (`SectionHeader` h2) | `text-base font-semibold tracking-tight text-white` |
| Subsection heading | `text-[13px] font-semibold text-white` (sentence case) |
| Body | `text-sm text-slate-200/300` |
| Secondary body | `text-sm text-slate-400` |
| Metadata label | `text-xs font-medium text-slate-500` (sentence case) |
| Metadata value / caption | `text-xs text-slate-400` |
| Identifiers / codes | `font-mono` at the surrounding size |

Rules: `font-black` does not exist. Uppercase + letter-spacing is reserved for
**semantic codes** (case numbers, bureau codes, classification markings) —
never for section labels. Hierarchy comes from size, weight and muting, not
from shouting.

## Radius

`rounded` (4px) chips/kbd · `rounded-lg` (8px) every surface and control ·
`rounded-xl` (12px) modal tier only (`Modal`, `dialog`) · `rounded-full` only
for dots, avatars and segmented switchers. Nothing else.

## Iconography

One set: `src/components/shell/icons.tsx` — 24×24 single-path stroke icons,
`currentColor`, 1.6 weight, rendered at 14–20px next to their labels. Emoji
are never interface elements (user-entered content excepted). No icon sits
inside a colored rounded square.

## Status & badges

`ui/Badge` is the one chip: `rounded px-2 py-0.5 text-[11px] font-semibold`,
tones from `lib/status` / `lib/tint` via `StatusBadge` — never hand-picked
classes per screen. Counts use the same geometry with `tabular-nums`. The
label always renders; color is never the only signal.

## Tabs

`ui/SectionTabs` (and the shell strips) draw **underline tabs**: active =
white text + 2px accent underline on a hairline baseline; inactive = muted
text. No filled pill tabs.

## Tables vs cards

Registry and list data renders in `ui/DataTable` (sorting, filtering,
selection, CSV, mobile card fallback via `mobileCard`). Cards are for
genuinely visual or heterogeneous content (mugshot boards, media, dashboards
of unlike panels) — never the default because a grid is easy.

## States

- Empty: `ui/Notice` `EmptyState` — what this is, why it's empty, what to do.
- Loading: `ui/Skeleton` shapes matching the content (`ListSkeleton`,
  `DetailSkeleton`, `CardGridSkeleton` only for real grids).
- Error: `ErrorNotice` — humanized message + Retry.

## Motion

Six keyframes total (view fade-up, modal pop, backdrop fade, skeleton pulse,
spinner), all ≤300ms, all disabled under `prefers-reduced-motion`. Motion
communicates state change; it never decorates. Adding an animation requires a
reason written in a comment.

## Shell

- **Sidebar**: flat brand tile, grouped nav with sentence-case group labels,
  one `navItemCls` recipe (quiet fill + 2px accent rail when active),
  meaningful count badges only, collapsible rail with flyout labels, drawer
  below `lg`.
- **Top bar**: fixed `h-14` (`--app-header-h: 3.5rem`), breadcrumb context
  (`Category / Page`), global search with `/` focus + `⌘K` palette, create
  menu, notifications, account controls. The page's `<h1>` lives in the view
  (`PageHeader`), unboxed on the canvas — never inside a hero card.

## Accessibility & performance

Focus rings follow the accent (`:focus-visible` global — an unlayered rule
that beats the Tailwind `outline-none` utility, so keyboard focus is always
visible). A skip link is the first focusable element in the shell. Touch
targets keep the 44px floor below `lg`; tappable controls set
`touch-action: manipulation` and overlays contain overscroll. Reduced motion
is honored everywhere. No new client-side dependencies for visuals; the icon
set is local, the animations are CSS.

## Stacking

One z-index scale, declared as tokens in `globals.css` and used as utilities:
`z-sticky` (10, in-page sticky bars) < `z-raised` (20) < `z-chrome` (30,
header / bottom nav / drawer backdrop) < `z-rail` (40, sidebar, sticky action
bar, assistant) < `z-modal` (50, modals and the palette) < `z-toast` (60) <
`z-dialog` (70, confirm dialogs) < `z-banner` (80, connectivity banner).
Nothing else; no `z-[…]` arbitrary values.

## Review

Run the `ui-review` project skill (`.claude/skills/ui-review/`) against
changed components before opening a UI pull request; it checks the vendored
Web Interface Guidelines plus this document.
