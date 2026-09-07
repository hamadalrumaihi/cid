/** Handler registry. ORDER MATTERS: rpc before the postgrest catch-all so
 *  /rest/v1/rpc/:fn never resolves as a table named "rpc"; the legal
 *  write-refusals (Phase 4 RPC-only tables → 42501) before the catch-all so
 *  a direct INSERT / UPDATE / DELETE never reaches the store. */
import { authHandlers } from './auth'
import { fivemanageHandlers } from './fivemanage'
import { legalHandlers } from './legal'
import { postgrestHandlers } from './postgrest'
import { rpcHandlers } from './rpc'

export const handlers = [
  ...authHandlers,
  ...rpcHandlers,
  ...legalHandlers,
  ...postgrestHandlers,
  ...fivemanageHandlers,
]
