/** next/navigation stub for the Vite builder (aliased in .storybook/main.ts).
 *  EntityLink.tsx is the only ui/ primitive that calls useRouter(); the stub
 *  routes navigation into the Storybook Actions panel instead of navigating,
 *  so clicking an entity chip is observable but never leaves the story. Only
 *  the members the ui/ primitives use are implemented — extend deliberately if
 *  a future story needs more. */
import { action } from 'storybook/actions'

const routerAction = action('next/navigation')

export interface StubRouter {
  push: (href: string) => void
  replace: (href: string) => void
  back: () => void
  forward: () => void
  refresh: () => void
  prefetch: (href: string) => Promise<void>
}

export function useRouter(): StubRouter {
  return {
    push: (href) => routerAction('router.push', href),
    replace: (href) => routerAction('router.replace', href),
    back: () => routerAction('router.back'),
    forward: () => routerAction('router.forward'),
    refresh: () => routerAction('router.refresh'),
    prefetch: async () => {},
  }
}

export function usePathname(): string {
  return '/'
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams()
}
