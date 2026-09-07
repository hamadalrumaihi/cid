/** Handler registry. ORDER MATTERS: rpc before the postgrest catch-all so
 *  /rest/v1/rpc/:fn never resolves as a table named "rpc"; the legal, report
 *  and intel write-refusals (Phase 4 / 5 / 6 RPC-only tables → 42501) before
 *  the catch-all so a direct INSERT / UPDATE / DELETE never reaches the store. */
import { authHandlers } from './auth'
import { fivemanageHandlers } from './fivemanage'
import { intelHandlers } from './intel'
import { legalHandlers } from './legal'
import { postgrestHandlers } from './postgrest'
import { reportHandlers } from './reports'
import { rpcHandlers } from './rpc'

export const handlers = [
  ...authHandlers,
  ...rpcHandlers,
  ...legalHandlers,
  ...reportHandlers,
  ...intelHandlers,
  ...postgrestHandlers,
  ...fivemanageHandlers,
]
