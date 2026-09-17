/** MSW node server — the vitest entry point (started/stopped by
 *  tests/msw/setup.ts). Intercepts globalThis.fetch, which is how the
 *  supabase-js client and fivemanage.ts reach the network: the client's
 *  portal-mode guard (src/lib/supabase.ts) resolves the global fetch at call
 *  time, so every request it lets through still lands here. */
import { setupServer } from 'msw/node'
import { handlers } from './handlers'

export const server = setupServer(...handlers)
