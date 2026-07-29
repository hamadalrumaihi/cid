/** Scenario presets — the one-import surface for tests. Data arrangements
 *  (roleSession + the case builders) come from ./fixtures; this module adds
 *  the network / permission shaping from the program's scenario list:
 *
 *    slowNetwork(ms)          every mocked response is delayed
 *    offline()                every request fails with a network error
 *    failedUpload(message)    FiveManage uploads return HTTP 500
 *    permissionDenied(table)  table grant revoked → every verb 403 / 42501
 *    rlsRestricted(table)     the silent wall: reads filtered to [], UPDATE/
 *                             DELETE match zero rows (no error), INSERT 403
 *    rpcResult(fn, value)     pin an RPC's next result (server-authoritative
 *                             flows are never re-implemented client-side)
 *
 *  Everything resets between tests via resetMockStore() (tests/msw/setup.ts).
 *
 *  NOT COVERED here — realtime. Supabase realtime is a WebSocket protocol
 *  MSW's http handlers cannot intercept, and the app degrades gracefully
 *  without it. To simulate a live update, bump the exported store directly:
 *
 *    import { useRealtimeStore } from '@/lib/realtime'
 *    useRealtimeStore.getState().bump('cases')   // subscribed views refetch
 */
import type { Database } from '@/lib/database.types'
import {
  setDenial, setFivemanageFailure, setLatency, setOffline, setRpcOverride,
  type MockTableName,
} from './store'

export function slowNetwork(ms = 1500): void {
  setLatency(ms)
}

export function offline(): void {
  setOffline(true)
}

export function failedUpload(message = 'FiveManage upload failed'): void {
  setFivemanageFailure(message)
}

export function permissionDenied(table: MockTableName): void {
  setDenial(table, 'grant')
}

export function rlsRestricted(table: MockTableName): void {
  setDenial(table, 'rls')
}

export function rpcResult<F extends keyof Database['public']['Functions']>(
  fn: F,
  value: Database['public']['Functions'][F]['Returns'],
): void {
  setRpcOverride(fn, value)
}

// Data-side builders re-exported so a spec needs a single import.
export {
  roleSession, profileRow,
  emptyCase, populatedCase, archivedCase, legalHoldCase, restrictedMediaCase,
  caseRow, caseTaskRow, legalHoldRow, legalRequestRow, mediaRow,
  notificationRow, personRow, reportRow,
  type MockRole, type RoleSessionResult, type CaseBundle,
} from './fixtures'
