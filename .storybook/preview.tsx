/** Preview config — replicates the app shell's theming contract so every
 *  story renders on the real dark surface with the real accent remap.
 *
 *  The app (src/app/layout.tsx PREF_APPLIER + src/lib/appearance.ts) sets
 *  `data-accent` on <body> and `data-density` on <html> before first paint;
 *  the ~45 deliberately UNLAYERED accent-override rules in globals.css key off
 *  those attributes. The toolbar globals below (4 accents × 2 densities) drive
 *  the same attributes, so accent QA is one toolbar click. There is NO light
 *  mode — the portal is dark-only by design. */
import React, { useEffect, useLayoutEffect } from 'react'
import type { Decorator, Preview } from '@storybook/react-vite'
import { useToastStore } from '../src/lib/toast'
import '../src/app/globals.css'

// Same body classes app/layout.tsx puts on the real <body>.
document.body.classList.add('font-sans', 'antialiased')

const ACCENTS = ['amber', 'blue', 'emerald', 'rose'] as const
const DENSITIES = ['comfortable', 'compact'] as const

function ThemeApplier({ accent, density, children }: {
  accent: string
  density: string
  children: React.ReactNode
}) {
  // Layout effect so the attributes land before paint (mirrors the app's
  // pre-hydration applier as closely as an iframe preview can).
  useLayoutEffect(() => {
    document.body.dataset.accent = accent
    document.documentElement.dataset.density = density
  }, [accent, density])
  return <>{children}</>
}

/** Module-level zustand stores outlive a story (they are app singletons), so
 *  state seeded or triggered by one story would leak into the next. Reset
 *  points, per store:
 *   - toast store (src/lib/toast.ts): exported — cleared directly before the
 *     incoming story's effects run.
 *   - dialog store (src/components/ui/dialog.tsx): module-private by design,
 *     so a stale pending dialog is cleared through its own public contract —
 *     if a leaked DialogCard re-rendered (only possible when the new story
 *     mounts <DialogHost/>), its document-level Escape handler is already
 *     registered by the time this parent effect runs, and one synthetic
 *     Escape resolves/clears it. No stale card → no-op.
 *   - realtime store (src/lib/realtime.ts): intentionally NOT imported here —
 *     no ui/ primitive subscribes to it, and importing it would drag the
 *     Supabase client into the Storybook bundle (stories must never talk to
 *     Supabase). */
function StoreReset({ children }: { children: React.ReactNode }) {
  // Before the incoming story renders/paints: drop any leaked toasts.
  useLayoutEffect(() => {
    useToastStore.setState({ toasts: [] })
  }, [])
  // After the story's own effects: dismiss a leaked confirm/prompt dialog.
  // DialogCard is the only element in the app with the z-[70] wrapper.
  useEffect(() => {
    if (document.getElementsByClassName('z-[70]').length > 0) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    }
  }, [])
  return <>{children}</>
}

const withTheme: Decorator = (Story, context) => (
  <ThemeApplier
    accent={String(context.globals.accent ?? 'amber')}
    density={String(context.globals.density ?? 'comfortable')}
  >
    <StoreReset>
      <Story />
    </StoreReset>
  </ThemeApplier>
)

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    accent: {
      description: 'CID accent theme (body[data-accent])',
      toolbar: {
        title: 'Accent',
        icon: 'paintbrush',
        items: [...ACCENTS],
        dynamicTitle: true,
      },
    },
    density: {
      description: 'UI density (html[data-density])',
      toolbar: {
        title: 'Density',
        icon: 'ruler',
        items: [...DENSITIES],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    // Matches the app defaults (layout.tsx PREF_APPLIER / appearance.ts).
    accent: 'amber',
    density: 'comfortable',
  },
  parameters: {
    layout: 'padded',
    // Accessibility stays ADVISORY (Phase 2 contract): findings annotate the
    // a11y panel but never fail a story or the CI build.
    a11y: { test: 'todo' },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
}

export default preview
