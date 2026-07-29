/** MSW node server — the vitest entry point (started/stopped by
 *  tests/msw/setup.ts). Intercepts globalThis.fetch, which is exactly how the
 *  supabase-js client (created without a custom fetch — src/lib/supabase.ts)
 *  and fivemanage.ts reach the network. */
import { setupServer } from 'msw/node'
import { handlers } from './handlers'

export const server = setupServer(...handlers)
