/** Handler registry. ORDER MATTERS: rpc before the postgrest catch-all so
 *  /rest/v1/rpc/:fn never resolves as a table named "rpc". */
import { authHandlers } from './auth'
import { fivemanageHandlers } from './fivemanage'
import { postgrestHandlers } from './postgrest'
import { rpcHandlers } from './rpc'

export const handlers = [
  ...authHandlers,
  ...rpcHandlers,
  ...postgrestHandlers,
  ...fivemanageHandlers,
]
