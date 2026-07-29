import { defineConfig } from 'vitest/config'
import path from 'node:path'

const alias = { '@': path.resolve(__dirname, 'src') }

// Two offline projects under one `npm test`:
//   unit — the pure-function suites colocated with the code (node env, no
//          setup, untouched from the pre-MSW layout).
//   msw  — component/data-layer tests (tests/msw/) that run the real
//          supabase-js client against the MSW mock server (happy-dom for
//          DOM rendering; setup starts the server with
//          onUnhandledRequest:'error' so nothing can slip to the network).
// The live suites keep their own configs: vitest.rls.config.ts (RLS wall),
// playwright*.config.ts (E2E/visual).
export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          include: ['src/**/*.test.{ts,tsx}'],
          environment: 'node',
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'msw',
          include: ['tests/msw/**/*.test.{ts,tsx}'],
          environment: 'happy-dom',
          // Order matters: env.ts must set NEXT_PUBLIC_* BEFORE setup.ts
          // (and anything it imports) evaluates src/lib/supabase.ts.
          setupFiles: ['tests/msw/env.ts', 'tests/msw/setup.ts'],
        },
      },
    ],
  },
})
