/** Handler registry. ORDER MATTERS: the Phase 7 action routes, the
 *  Phase 8 trash routes, the CI compartment routes and the platform-upgrade
 *  evidence routes (explicit /rest/v1/rpc/<fn> per function) before the
 *  generic rpc catch-all so they win the match; rpc before the postgrest catch-all so /rest/v1/rpc/:fn
 *  never resolves as a table named "rpc"; the legal, report, intel and
 *  action write-refusals (Phase 4 / 5 / 6 / 7 RPC-only tables → 42501)
 *  before the catch-all so a direct INSERT / UPDATE / DELETE never reaches
 *  the store. */
import { actionHandlers } from './action'
import { authHandlers } from './auth'
import { ciHandlers } from './ci'
import { documentHandlers } from './documents'
import { fivemanageHandlers } from './fivemanage'
import { intelHandlers } from './intel'
import { legalHandlers } from './legal'
import { platformHandlers } from './platform'
import { postgrestHandlers } from './postgrest'
import { reportHandlers } from './reports'
import { rpcHandlers } from './rpc'
import { trashHandlers } from './trash'

export const handlers = [
  ...authHandlers,
  ...actionHandlers,
  ...trashHandlers,
  ...ciHandlers,
  ...platformHandlers,
  ...documentHandlers,
  ...rpcHandlers,
  ...legalHandlers,
  ...reportHandlers,
  ...intelHandlers,
  ...postgrestHandlers,
  ...fivemanageHandlers,
]
