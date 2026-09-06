/** Query-shape contracts for the db-backed entitySearch arms. The colocated
 *  entitySearch.test.ts covers the pure pieces (normalizers, ranking, the
 *  client-cache kinds); THIS file mocks list()/rpc() and asserts what each
 *  kind actually sends to the database:
 *
 *    - the registry kinds (person, vehicle, gang, place, account, case,
 *      narcotic) send a typed query to the `entity_suggest` RPC
 *      ({ p_kind, p_q, p_limit }) and map its rows through toHit — the
 *      server's order (exact-normalized hits first) is kept as-is;
 *    - a blank query lists the most recent rows (order updated_at desc) —
 *      projected, bounded, tombstones filtered — and never an ilike arm;
 *    - exclude sets and the limit are applied client-side;
 *    - operation / legal_request (no RPC arm) still build their disjunction
 *      through ilikeAny (the REAL ilikeAny runs here, only list/rpc mocked);
 *    - every read is projected (never select '*', never an email column)
 *      and bounded; a transient failure degrades to [] — never a throw. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  searchAccountHits, searchCaseHits, searchEntities, searchNarcoticHits, searchPersonHits,
  searchPlaceHits, searchVehicleHits, type EntityKind,
} from './entitySearch'
import { ilikeAny, list, rpc } from './db'

vi.mock('./db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db')>()
  return { ...actual, list: vi.fn(), rpc: vi.fn() }
})

const listMock = vi.mocked(list)
const rpcMock = vi.mocked(rpc)

type Opts = Record<string, unknown>
/** Install a table-dispatching list() implementation returning plain rows. */
function answerList(fn: (table: string, opts: Opts) => unknown[]) {
  listMock.mockImplementation((async (table: unknown, opts: unknown) =>
    fn(table as string, (opts ?? {}) as Opts)) as unknown as typeof list)
}
const listCalls = (): Array<{ table: string; opts: Opts }> =>
  listMock.mock.calls.map(([t, o]) => ({ table: t as string, opts: (o ?? {}) as Opts }))

const suggestRow = (id: string, over: Opts = {}): Opts =>
  ({ id, kind: 'person', label: `Row ${id}`, sublabel: null, score: 0.5, exact: false, ...over })

beforeEach(() => {
  vi.resetAllMocks()
  answerList(() => [])
  rpcMock.mockResolvedValue({ data: null, error: null } as never)
})

/* ── Persons — entity_suggest + stable re-rank ───────────────────────────── */

describe('searchPersonHits query shape', () => {
  it('routes a typed query through entity_suggest (bounded) and maps rows via toHit', async () => {
    rpcMock.mockResolvedValue({
      data: [
        suggestRow('p1', { label: 'Marcus Reed', sublabel: 'Reedy · active', exact: true }),
        suggestRow('p2', { label: 'Marcus Vale', sublabel: null }),
      ],
      error: null,
    } as never)

    const hits = await searchPersonHits('marcus')
    expect(rpcMock).toHaveBeenCalledWith('entity_suggest', { p_kind: 'person', p_q: 'marcus', p_limit: 28 })
    // No hydration round-trip: the RPC answer IS the picker row.
    expect(listMock).not.toHaveBeenCalled()
    expect(hits).toEqual([
      { id: 'p1', label: 'Marcus Reed', sublabel: 'Reedy · active', meta: { kind: 'person', exact: '1' } },
      { id: 'p2', label: 'Marcus Vale', sublabel: undefined, meta: { kind: 'person', exact: null } },
    ])
  })

  it('keeps the server order (exact first) and applies exclude', async () => {
    rpcMock.mockResolvedValue({
      data: [suggestRow('p1', { label: 'Mo', exact: true }), suggestRow('p2', { label: 'Mona' }), suggestRow('p3', { label: 'Moe' })],
      error: null,
    } as never)
    expect((await searchPersonHits('mo')).map((h) => h.id)).toEqual(['p1', 'p2', 'p3'])
    expect((await searchPersonHits('mo', { exclude: new Set(['p1']) })).map((h) => h.id)).toEqual(['p2', 'p3'])
  })

  it('blank query lists the most recent persons — projected, bounded, merged tombstones dropped', async () => {
    answerList((table) => table === 'persons'
      ? [
        { id: 'p1', name: 'Marcus Reed', alias: 'Reedy', status: 'active', lifecycle: 'active' },
        { id: 'dead', name: 'Gone', alias: null, status: null, lifecycle: 'merged' },
      ]
      : [])
    const hits = await searchPersonHits('   ')
    expect(rpcMock).not.toHaveBeenCalled()
    const call = listCalls().find((c) => c.table === 'persons')!
    expect(call.opts).toMatchObject({ select: 'id,name,alias,status,lifecycle', order: 'updated_at', ascending: false, limit: 28 })
    expect(call.opts.or).toBeUndefined()
    expect(hits).toEqual([{ id: 'p1', label: 'Marcus Reed', sublabel: 'Reedy · active', meta: { kind: 'person', exact: null } }])
  })

  it('a one-character query takes the blank path (entity_suggest needs 2)', async () => {
    await searchPersonHits('m')
    expect(rpcMock).not.toHaveBeenCalled()
    expect(listCalls().find((c) => c.table === 'persons')).toBeDefined()
  })

  it('degrades to [] on RPC error, empty RPC result, or a thrown recent-list read', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } } as never)
    expect(await searchPersonHits('xx')).toEqual([])
    rpcMock.mockResolvedValue({ data: [], error: null } as never)
    expect(await searchPersonHits('xx')).toEqual([])
    listMock.mockRejectedValue(new Error('network blip'))
    expect(await searchPersonHits('')).toEqual([])
  })
})

/* ── Vehicles / accounts — the normalized arms now live in the RPC ───────── */

describe('vehicle and account arms', () => {
  it("vehicles: 'ab-123' goes to entity_suggest verbatim — the server's norm_plate arm crosses separators", async () => {
    rpcMock.mockResolvedValue({
      data: [suggestRow('v1', { kind: 'vehicle', label: 'AB123', sublabel: 'Sultan · black', exact: true }), suggestRow('v9', { kind: 'vehicle', label: 'AB-999' })],
      error: null,
    } as never)
    const hits = await searchVehicleHits('ab-123')
    expect(rpcMock).toHaveBeenCalledWith('entity_suggest', { p_kind: 'vehicle', p_q: 'ab-123', p_limit: 28 })
    expect(listMock).not.toHaveBeenCalled()
    expect(hits.map((h) => h.id)).toEqual(['v1', 'v9'])
    expect(hits[0]).toMatchObject({ label: 'AB123', sublabel: 'Sultan · black', meta: { kind: 'vehicle', exact: '1' } })
  })

  it("accounts: '@CoolGuy' goes to entity_suggest verbatim — handle_normalized is matched server-side", async () => {
    rpcMock.mockResolvedValue({ data: [suggestRow('a1', { kind: 'account', label: '@coolguy', sublabel: 'birdnet', exact: true })], error: null } as never)
    const hits = await searchAccountHits('@CoolGuy')
    expect(rpcMock).toHaveBeenCalledWith('entity_suggest', { p_kind: 'account', p_q: '@CoolGuy', p_limit: 28 })
    expect(hits.map((h) => h.label)).toEqual(['@coolguy'])
  })

  it('accounts: blank query lists recent live accounts with the @handle label', async () => {
    answerList((table) => table === 'accounts'
      ? [
        { id: 'a1', platform: 'birdnet', handle: 'coolguy', display_name: 'Cool Guy', lifecycle: 'active' },
        { id: 'dead', platform: 'birdnet', handle: 'old', display_name: null, lifecycle: 'merged' },
      ]
      : [])
    const hits = await searchAccountHits('')
    expect(hits).toEqual([{ id: 'a1', label: '@coolguy', sublabel: 'birdnet · Cool Guy', meta: { kind: 'account', exact: null } }])
  })
})

/* ── Limit and blank-query recent path (representative kinds) ───────────── */

describe('limit and blank-query recent path', () => {
  it('the limit caps the RPC request (limit + overfetch, never above 50) and the answer', async () => {
    rpcMock.mockResolvedValue({ data: [suggestRow('g1'), suggestRow('g2'), suggestRow('g3')], error: null } as never)
    const hits = await searchEntities('gang', 'delta', { limit: 2 })
    expect(rpcMock).toHaveBeenCalledWith('entity_suggest', { p_kind: 'gang', p_q: 'delta', p_limit: 10 })
    expect(hits).toHaveLength(2)
    rpcMock.mockClear()
    await searchCaseHits('delta', { limit: 50 })
    expect(rpcMock).toHaveBeenCalledWith('entity_suggest', { p_kind: 'case', p_q: 'delta', p_limit: 50 })
  })

  it('places: no or-filter, ordered updated_at desc, bounded, projected', async () => {
    await searchPlaceHits('')
    const call = listCalls().find((c) => c.table === 'places')!
    expect(call.opts.or).toBeUndefined()
    expect(call.opts).toMatchObject({
      select: 'id,name,type,area', order: 'updated_at', ascending: false, limit: 28,
    })
  })

  it('narcotics: blank query excludes merged rows at the query level (is merged_into null)', async () => {
    answerList((table) => table === 'narcotics'
      ? [{ id: 'n1', name: 'Redline', category: 'stimulant', status: 'active' }]
      : [])
    const hits = await searchNarcoticHits('')
    const call = listCalls().find((c) => c.table === 'narcotics')!
    expect(call.opts).toMatchObject({
      is: { merged_into: null }, order: 'updated_at', ascending: false, limit: 28,
    })
    expect(hits[0]).toEqual({ id: 'n1', label: 'Redline', sublabel: 'stimulant · active', meta: { kind: 'narcotic', exact: null } })
  })

  it('narcotics: a typed query goes through entity_suggest, bounded', async () => {
    rpcMock.mockResolvedValue({ data: [suggestRow('n1', { kind: 'narcotic', label: 'Redline' })], error: null } as never)
    const hits = await searchNarcoticHits('red')
    expect(rpcMock).toHaveBeenCalledWith('entity_suggest', { p_kind: 'narcotic', p_q: 'red', p_limit: 28 })
    expect(listMock).not.toHaveBeenCalled()
    expect(hits[0]).toMatchObject({ id: 'n1', meta: { kind: 'narcotic' } })
  })
})

/* ── Kinds without an RPC arm keep the ilikeAny disjunction ─────────────── */

describe('operation / legal_request query shape', () => {
  it('operations: ilikeAny over name/description, projected and bounded', async () => {
    await searchEntities('operation', 'thunder')
    expect(rpcMock).not.toHaveBeenCalled()
    const call = listCalls().find((c) => c.table === 'operations')!
    expect(call.opts.or).toBe(ilikeAny(['name', 'description'], 'thunder'))
    expect(call.opts).toMatchObject({ select: 'id,name,description,status,op_type', limit: 28 })
  })

  it('legal requests: ilikeAny over request_number/title; blank lists recent', async () => {
    await searchEntities('legal_request', 'LR-26')
    const call = listCalls().find((c) => c.table === 'legal_requests')!
    expect(call.opts.or).toBe(ilikeAny(['request_number', 'title'], 'LR-26'))
    listMock.mockClear()
    await searchEntities('legal_request', '')
    const blank = listCalls().find((c) => c.table === 'legal_requests')!
    expect(blank.opts.or).toBeUndefined()
    expect(blank.opts).toMatchObject({ order: 'updated_at', ascending: false, limit: 28 })
  })
})

/* ── Cross-kind invariants ──────────────────────────────────────────────── */

const RPC_KINDS: EntityKind[] = ['person', 'vehicle', 'gang', 'place', 'account', 'case', 'narcotic']
const ILIKE_KINDS: EntityKind[] = ['operation', 'legal_request']
const DB_KINDS: EntityKind[] = [...RPC_KINDS, ...ILIKE_KINDS]

describe('cross-kind invariants (every db-backed arm)', () => {
  it('every registry kind sends its typed query to entity_suggest under its own p_kind', async () => {
    rpcMock.mockResolvedValue({ data: [suggestRow('x')], error: null } as never)
    for (const kind of RPC_KINDS) await searchEntities(kind, 'delta')
    expect(rpcMock.mock.calls.map(([fn, args]) => [fn, (args as Opts).p_kind])).toEqual(RPC_KINDS.map((k) => ['entity_suggest', k]))
    for (const [, args] of rpcMock.mock.calls) expect((args as Opts).p_limit).toBe(28)
    // A typed query never falls back to a table read.
    expect(listMock).not.toHaveBeenCalled()
  })

  it('every table read is projected (no *, no email) and bounded; every or is an ilikeAny product', async () => {
    for (const kind of DB_KINDS) await searchEntities(kind, '')
    for (const kind of ILIKE_KINDS) await searchEntities(kind, 'delta')

    expect(listCalls().length).toBeGreaterThan(0)
    for (const { table, opts } of listCalls()) {
      const select = String(opts.select ?? '')
      // Projection discipline: an entity picker must never read '*' — and in
      // particular can never carry an email column (profiles email is
      // command-granted; persons has none, but the string ban is absolute).
      expect(select, `${table} projection`).toBeTruthy()
      expect(select).not.toContain('*')
      expect(select.toLowerCase()).not.toContain('email')
      expect(Boolean(opts.limit), `${table} bounded`).toBe(true)
    }
    // Every or-disjunction is exactly an ilikeAny product: each clause is
    // col.ilike.*term* — user input can never smuggle extra conditions.
    for (const { table, opts } of listCalls()) {
      if (typeof opts.or !== 'string') continue
      expect(['operations', 'legal_requests'], `${table} or-arm`).toContain(table)
      for (const clause of opts.or.split(',')) {
        expect(clause).toMatch(/^[a-z_]+\.ilike\.\*[^,()]*\*$/)
      }
    }
  })

  it('a transient failure degrades every async kind to [] — never a throw', async () => {
    listMock.mockRejectedValue(new Error('fetch failed'))
    rpcMock.mockResolvedValue({ data: null, error: { message: 'unavailable' } } as never)
    for (const kind of DB_KINDS) {
      await expect(searchEntities(kind, 'anything'), kind).resolves.toEqual([])
      await expect(searchEntities(kind, ''), kind).resolves.toEqual([])
    }
    rpcMock.mockRejectedValue(new Error('rpc transport down'))
    for (const kind of RPC_KINDS) await expect(searchEntities(kind, 'anything'), kind).resolves.toEqual([])
  })
})
