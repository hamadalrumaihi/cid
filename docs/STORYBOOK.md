# Storybook — the ui/ component workshop

Phase 2 of the integration program: an isolated, network-free workshop for the
shared primitives in `src/components/ui/`. It renders the real components on
the real dark theme (globals.css tokens + the unlayered accent remap) with no
app shell, no AuthContext, and **no Supabase**.

## Running it

```bash
npm run storybook        # dev server on http://localhost:6006
npm run build-storybook  # static build → storybook-static/ (gitignored)
```

No env vars are needed — if a story can't render without one, the story is
wrong (see “Rules for new stories”).

## Why the Vite builder (not @storybook/nextjs)

The app pins `next@16.2.10` exactly; the Storybook Next.js framework package
trails Next majors and webpack-couples the build. The ui/ primitives are plain
client components, so `@storybook/react-vite` renders them faithfully with two
shims (both in `.storybook/main.ts`):

- **Tailwind v4** via `@tailwindcss/vite`. The app is CSS-first — all tokens
  live in `src/app/globals.css` `@theme`; there is no `tailwind.config` to
  port, and the ~45 deliberately **unlayered** accent-override rules load
  unchanged (do not re-layer them here either).
- **next/navigation** aliased to `.storybook/mocks/next-navigation.ts`.
  `EntityLink` is the only ui/ primitive that calls `useRouter()`; the stub
  logs `router.push(href)` to the Actions panel instead of navigating.
  `next/dynamic` (the lazy `RichEditor` wrapper) resolves to the real package
  and still code-splits the Tiptap chunk.

## Theme toolbar (accent × density)

The app applies appearance before first paint (`src/app/layout.tsx`
PREF_APPLIER / `src/lib/appearance.ts`): `data-accent` on `<body>`,
`data-density` on `<html>`. The preview decorator in `.storybook/preview.tsx`
drives the same attributes from two toolbar controls:

- **Accent** — amber (default), blue, emerald, rose. Flips the `--acc-*`
  variables that the unlayered remap consumes, so accent QA on any primitive
  is one toolbar click.
- **Density** — comfortable (default), compact (`html { font-size: 14px }`).

There is **no light mode** — the portal is dark-only by design; the preview
body carries `font-sans antialiased` and the `--color-ink-950` background from
globals.css.

## Store hygiene between stories

Module-level zustand stores are app singletons and outlive a story. The
preview decorator resets them on every story mount:

- **toast store** — cleared directly (exported from `src/lib/toast`).
- **dialog store** — module-private by design, so a leaked pending
  confirm/prompt is dismissed through its public contract: if it re-renders
  under the incoming story's `<DialogHost/>`, one synthetic Escape resolves it.
- **realtime store** — intentionally untouched: no ui/ primitive subscribes to
  it, and importing `src/lib/realtime` would pull the Supabase client into the
  Storybook bundle.

## Accessibility (advisory)

`@storybook/addon-a11y` runs axe on every story; findings show in the
Accessibility panel. It is configured as `test: 'todo'` — **advisory, never
blocking** — matching the app's approach (the blocking ratchet lives in the
Playwright axe suite against the real app, `tests/e2e/a11y.spec.ts`).

## CI + sharing builds (free)

`.github/workflows/storybook.yml` builds the static Storybook on PRs touching
`src/components/ui/**` or `.storybook/**` and uploads `storybook-static/` as a
workflow **artifact** (private to the repo, free). To review a build: PR →
Checks → Storybook → Artifacts → download, unzip, open `index.html` (or
`npx http-server storybook-static`). The build step is blocking; a11y is not.

We deliberately do **not** host Storybook publicly: the portal is a restricted
tool and free static hosts are world-readable. If password-protected hosting
is ever wanted, Vercel deployment protection covers it but requires a paid
plan — optional, not part of this phase. No Chromatic.

## Adding stories

1. Colocate: `src/components/ui/Thing.stories.tsx` next to the component.
2. Import types from the framework package:
   `import type { Meta, StoryObj } from '@storybook/react-vite'`.
3. `const meta = { title: 'UI/Thing', component: Thing, … } satisfies Meta<typeof Thing>`;
   use `type Story = StoryObj<typeof meta>` for args-driven stories and a bare
   `StoryObj` for render-only stories (stateful wrappers, galleries).
4. Cover the states that matter: default, compact/dense, long content, empty,
   disabled, error, loading, keyboard focus — skip variants that don't exist.
5. Rules:
   - **No network, no Supabase, no production data.** Story data comes from
     the typed builders in `src/mocks/fixtures/` (schema-checked against
     `database.types.ts`) or small inline literals.
   - Deterministic time: components taking `now` (DeadlineChip,
     StaleIntelBadge) get a fixed timestamp, never `Date.now()`.
   - Reuse primitives and `src/lib/tint.ts` inside stories the same way app
     code must — stories are documentation of correct usage.
   - Import `RichEditor` via its lazy wrapper, never `RichEditorInner`.
6. Gates: stories are part of `src` — they must pass `npx tsc --noEmit`,
   `npx eslint src --max-warnings 0` and `npx knip`. They are excluded from
   the app bundle automatically (nothing imports them), and `npm run
   check:bundle` proves the budget is unchanged.

## Out of scope (this phase)

- **Domain components** (`src/components/cases`, `gangs`, `command-center`,
  …): they read the module-private AuthContext, fetch through the data layer,
  and depend on RLS-shaped responses. Rendering them honestly needs the
  MSW browser worker (`src/mocks/browser.ts`) plus an auth harness — that is
  the next phase, not a reason to export AuthContext today.
- `src/components/shared/` pickers (RecordSearchPicker etc.): same reason —
  they query through the data layer.
- Visual regression on stories (the Playwright visual suite already covers
  key app screens); revisit only with a free, in-repo runner.
