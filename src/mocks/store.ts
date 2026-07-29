/** In-memory backing store for the MSW PostgREST handlers — dev/test ONLY.
 *
 *  One flat map of table → rows plus the per-scenario switches (policy
 *  denials, network shaping, session). Handlers read and mutate this state;
 *  fixtures (src/mocks/fixtures/) seed it with rows typed against
 *  database.types.ts; scenarios (src/mocks/scenarios.ts) flip the switches.
 *  resetMockStore() restores everything between tests (wired in
 *  tests/msw/setup.ts) so specs stay independent. */
import type { Database, Tables } from '@/lib/database.types'
import { MSW_BUNDLE_SENTINEL } from './env'

// Referenced so every store import carries the bundle sentinel (see env.ts).
void MSW_BUNDLE_SENTINEL

export type MockTableName = keyof Database['public']['Tables']
export type MockRow = Record<string, unknown>

/** How a write against a table fails under the current scenario:
 *  - 'rls'   — row-level policy: INSERT → 403 "violates row-level security";
 *              UPDATE/DELETE silently match ZERO rows (no error — the shape
 *              db.ts's contract calls "RLS-blocked"). Reads are filtered to [].
 *  - 'grant' — table/column grant revoked: every verb → 403 code 42501
 *              "permission denied for table …". */
export type DenialMode = 'rls' | 'grant'

export interface MockAuthSession {
  /** Must equal the seeded profiles row id. */
  userId: string
  email: string
  password: string
}

interface MockState {
  tables: Map<MockTableName, MockRow[]>
  denials: Map<MockTableName, DenialMode>
  session: MockAuthSession | null
  /** Artificial latency (ms) applied to every mocked response. */
  latencyMs: number
  /** When true every handler answers with a network error. */
  offline: boolean
  /** When set, FiveManage uploads fail with this message (HTTP 500). */
  fivemanageFailure: string | null
  /** Per-function RPC result overrides (takes precedence over built-ins). */
  rpcOverrides: Map<string, unknown>
}

const freshState = (): MockState => ({
  tables: new Map(),
  denials: new Map(),
  session: null,
  latencyMs: 0,
  offline: false,
  fivemanageFailure: null,
  rpcOverrides: new Map(),
})

let state = freshState()
let idCounter = 0

/** Restore pristine state — call between tests (setup.ts does). */
export function resetMockStore(): void {
  state = freshState()
  idCounter = 0
}

/** Deterministic uuid-shaped ids so fixtures and assertions stay stable
 *  within a test run (counter resets with the store). */
export function mockId(): string {
  idCounter += 1
  return `00000000-0000-4000-a000-${String(idCounter).padStart(12, '0')}`
}

/** Fixed timestamp base — fixtures offset from this, never from Date.now(),
 *  so ordering assertions are deterministic. */
export const MOCK_EPOCH = '2026-07-01T12:00:00.000Z'

export function mockTimestamp(offsetMinutes = 0): string {
  return new Date(Date.parse(MOCK_EPOCH) + offsetMinutes * 60_000).toISOString()
}

/* ---- rows ---------------------------------------------------------------- */

/** Seed fully-typed rows. The Tables<T> constraint is the schema-fidelity
 *  anchor: fixtures MUST satisfy the generated Row types, so schema drift
 *  breaks `tsc --noEmit` instead of silently forking a parallel model. */
export function seedRows<T extends MockTableName>(table: T, rows: Tables<T>[]): Tables<T>[] {
  const existing = state.tables.get(table) ?? []
  state.tables.set(table, [...existing, ...rows] as MockRow[])
  return rows
}

/** Raw row access for handlers (untyped inside the mock boundary, mirroring
 *  db.ts's single any-boundary pattern). */
export function getRows(table: MockTableName): MockRow[] {
  return state.tables.get(table) ?? []
}

export function setRows(table: MockTableName, rows: MockRow[]): void {
  state.tables.set(table, rows)
}

/** Typed read-back for assertions in tests. */
export function readRows<T extends MockTableName>(table: T): Tables<T>[] {
  return getRows(table) as unknown as Tables<T>[]
}

/* ---- policy / network switches ------------------------------------------ */

export function setDenial(table: MockTableName, mode: DenialMode | null): void {
  if (mode === null) state.denials.delete(table)
  else state.denials.set(table, mode)
}

export function getDenial(table: MockTableName): DenialMode | null {
  return state.denials.get(table) ?? null
}

export function setSession(session: MockAuthSession | null): void {
  state.session = session
}

export function getSession(): MockAuthSession | null {
  return state.session
}

export function setLatency(ms: number): void {
  state.latencyMs = ms
}

export function getLatency(): number {
  return state.latencyMs
}

export function setOffline(offline: boolean): void {
  state.offline = offline
}

export function isOffline(): boolean {
  return state.offline
}

export function setFivemanageFailure(message: string | null): void {
  state.fivemanageFailure = message
}

export function getFivemanageFailure(): string | null {
  return state.fivemanageFailure
}

export function setRpcOverride(fn: string, result: unknown): void {
  state.rpcOverrides.set(fn, result)
}

export function getRpcOverride(fn: string): { hit: boolean; result: unknown } {
  return state.rpcOverrides.has(fn)
    ? { hit: true, result: state.rpcOverrides.get(fn) }
    : { hit: false, result: undefined }
}
