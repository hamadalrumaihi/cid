/** MSW project setup, file 2 of 2 — server lifecycle.
 *
 *  onUnhandledRequest: 'error' is the containment guarantee: any request a
 *  handler does not match fails the test instead of escaping to the network,
 *  so this suite can never touch a live Supabase project (and the base URL is
 *  an unresolvable .test host besides — see env.ts).
 *
 *  resetMockStore() between tests keeps specs independent: seeded rows,
 *  permission denials, latency/offline flags, sessions, and RPC overrides
 *  all vanish; deterministic ids restart from 1. */
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from '@/mocks/server'
import { resetMockStore } from '@/mocks/store'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))

afterEach(() => {
  server.resetHandlers()
  resetMockStore()
})

afterAll(() => server.close())
