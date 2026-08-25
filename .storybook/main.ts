/** Storybook (Phase 2) — component workshop for the shared ui/ primitives.
 *
 *  Builder: @storybook/react-vite, NOT @storybook/nextjs. The app pins
 *  next@16.2.10 (App Router) and the Next framework package lags behind Next
 *  majors; the ui/ primitives are plain client components, so the Vite builder
 *  renders them faithfully with two small shims:
 *   - Tailwind v4 via @tailwindcss/vite (the app is CSS-first — tokens live in
 *     src/app/globals.css @theme; there is NO tailwind.config to wire up).
 *   - next/navigation aliased to .storybook/mocks/next-navigation.ts —
 *     EntityLink is the only ui/ primitive that touches the router, and the
 *     stub routes push/replace into the Actions panel.
 *
 *  Scope is deliberately the provider-free primitive layers — src/components/
 *  ui/ plus the dash/ dashboard primitives (their wired variants stay out;
 *  DashSwitcherView is the storyable core) — domain components need
 *  AuthContext (module-private by design) and live data; see docs/STORYBOOK.md.
 */
import { fileURLToPath } from 'node:url'
import type { StorybookConfig } from '@storybook/react-vite'
import { mergeConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url))

const config: StorybookConfig = {
  stories: [
    '../src/components/ui/**/*.stories.@(ts|tsx)',
    '../src/components/dash/**/*.stories.@(ts|tsx)',
  ],
  addons: [
    // Advisory only — parameters.a11y.test is 'todo' in preview.tsx, so
    // violations annotate the panel without failing anything.
    '@storybook/addon-a11y',
  ],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  core: {
    // Restricted internal tool — no anonymous usage telemetry.
    disableTelemetry: true,
  },
  async viteFinal(base) {
    return mergeConfig(base, {
      plugins: [tailwindcss()],
      resolve: {
        alias: [
          // Router stub (see header). Exact-match find, so other next/*
          // entrypoints (e.g. next/dynamic for the lazy RichEditor) still
          // resolve to the real package.
          { find: 'next/navigation', replacement: here('./mocks/next-navigation.ts') },
          // Mirror tsconfig's `@/*` → `src/*` path mapping.
          { find: '@', replacement: here('../src') },
        ],
      },
    })
  },
}

export default config
