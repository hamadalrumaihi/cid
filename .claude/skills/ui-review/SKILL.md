---
name: ui-review
description: Review changed CID Portal UI files against the vendored Web Interface Guidelines (accessibility, focus, forms, animation, typography, content, images, performance, navigation state, touch, safe areas, dark mode, i18n, hydration, hover, copy) plus the portal's own design rules. Use before opening any pull request that touches src/components/** or src/app/**, or when asked to "review my UI", "check accessibility", or "audit design".
---

# UI review (CID Portal)

Review the given files (or the current diff under `src/components/` and
`src/app/`) against `rules.md` in this folder — a vendored copy of the Vercel
Web Interface Guidelines with the portal's own design-system rules appended.
The rules are checked into the repo on purpose: CI and web sessions may not
have network access, and the portal's rules override the upstream list where
they conflict.

## How it works

1. Read `.claude/skills/ui-review/rules.md`.
2. Read the files under review (`git diff --name-only main -- src/components src/app`
   when no files are given).
3. Check every rule. Skip rules that cannot apply to the file (a pure data
   module has no focus states).
4. Report findings in the terse form `file:line — rule — what to change`,
   most severe first. Say "no findings" when there are none. Do not restyle;
   this is a review, and permissions, RLS, workflows and focus management are
   never touched during visual work (`docs/DESIGN-SYSTEM.md` principle 5).

## Portal-specific notes the reviewer must know

- Keyboard focus is provided globally: `src/app/globals.css` gives every
  `button / a / input / select / textarea / summary / [tabindex]` an accent
  `:focus-visible` outline, and that unlayered rule beats the Tailwind
  `outline-none` utility. `outline-none` on an input is therefore acceptable
  **only** when that global rule still applies (no `outline: none` on
  `:focus-visible`, no `focus:outline-none` on a custom element). Flag any
  element that opts out of `:focus-visible` explicitly.
- The design system is dark-only; `color-scheme: dark` is set on `:root` and
  `<meta name="theme-color">` comes from `src/app/layout.tsx`.
- Z-index comes from the scale in `globals.css` (`--z-*`); ad-hoc `z-[…]`
  values are findings.
- Touch targets keep the 44 px floor below `lg` (`Button` sizes do this);
  `Modal` sets `overscroll-behavior: contain`.
- Reduced motion is honored globally; new keyframes need a written reason.
- Dates and numbers go through `src/lib/format.ts`; hand-rolled formatting is
  a finding (P8-08 sweep).
