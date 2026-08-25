/** Query-shape contracts for the db-backed entitySearch arms. The colocated
 *  entitySearch.test.ts covers the pure pieces (normalizers, ranking, the
 *  client-cache kinds); THIS file mocks list()/rpc() and asserts what each
 *  kind actually sends to the database:
 *
 *    - every read is projected (never select '*', never profiles/persons
 *      email) and bounded (a limit, or an in:{id} set from a bounded step);
 *    - or-disjunctions are built through ilikeAny (the sanctioned injection
 *      boundary — the REAL ilikeAny runs here, only list/rpc are mocked);
 *    - merged tombstones and exclude sets are filtered client-side;
 *    - the exact-normalized arms (plate, handle) fire exactly when the
 *      normalizers say ilike alone would miss;
 *    - blank query ⇒ most-recent rows (order updated_at desc);
 *    - a transient failure degrades to [] — a picker must never throw. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  searchAccountHits, searchEntities, searchNarcoticHits, searchPersonHits,
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

beforeEach(() => {
  vi.resetAllMocks()
  answerList(() => [])
  rpcMock.mockResolvedValue({ data: null, error: null } as never)
})

/* ── Persons — RPC two-step ─────────────────────────────────────────────── */

describe('searchPersonHits query shape', () => {
  const personRow = (id: string, over: Opts = {}): Opts => ({
    id, name: `Person ${id}`, alias: null, dob: null, phone: null,
    status: null, gang_id: null, mugshot_url: null, lifecycle: 'active', ...over,
  })

  it('routes through search_persons (bounded), hydrates by id with the lite projection', async () => {
    rpcMock.mockResolvedValue({ data: [{ id: 'p1', rank: 1 }, { id: 'p2', rank: 2 }], error: null } as never)
    answerList((table) => table === 'persons' ? [personRow('p1'), personRow('p2')] : [])

    const hits = await searchPersonHits('marcus')
    expect(rpcMock).toHaveBeenCalledWith('search_persons', { p_q: 'marcus', p_limit: 28 })

    const hydrate = listCalls().find((c) => c.table === 'persons')!
    // Bounded by the RPC's id set, projected — and the projection can never
    // leak columns the picker has no business reading (no '*', no email).
    expect(hydrate.opts.in).toEqual({ id: ['p1', 'p2'] })
    expect(hydrate.opts.select).toBe('id,name,alias,dob,phone,status,gang_id,mugshot_url,lifecycle')
    expect(hits.map((h) => h.id)).toEqual(['p1', 'p2'])
  })

  it('filters merged tombstones and applies exclude after hydration', async () => {
    rpcMock.mockResolvedValue({
      data: [{ id: 'p1', rank: 1 }, { id: 'dead', rank: 2 }, { id: 'p3', rank: 3 }], error: null,
    } as never)
    answerList((table) => table === 'persons'
      ? [personRow('p1'), personRow('dead', { lifecycle: 'merged' }), personRow('p3')]
      : [])
    // A merged person is a dead record — linking to it would silently orphan.
    expect((await searchPersonHits('m')).map((h) => h.id)).toEqual(['p1', 'p3'])
    expect((await searchPersonHits('m', { exclude: new Set(['p1']) })).map((h) => h.id)).toEqual(['p3'])
  })

  it('blank query lists the most recent persons, still bounded and projected', async () => {
    answerList((table) => table === 'persons' ? [personRow('p1')] : [])
    await searchPersonHits('   ')
    expect(rpcMock).not.toHaveBeenCalled()
    const call = listCalls().find((c) => c.table === 'persons')!
    expect(call.opts).toMatchObject({ order: 'updated_at', ascending: false, limit: 28 })
    expect(call.opts.select).not.toContain('*')
  })

  it('degrades to [] on RPC error, empty RPC result, or a thrown hydration', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } } as never)
    expect(await searchPersonHits('x')).toEqual([])
    rpcMock.mockResolvedValue({ data: [], error: null } as never)
    expect(await searchPersonHits('x')).toEqual([])
    rpcMock.mockResolvedValue({ data: [{ id: 'p1', rank: 1 }], error: null } as never)
    listMock.mockRejectedValue(new Error('network blip'))
    expect(await searchPersonHits('x')).toEqual([])
  })
})

/* ── Vehicles — ilike arm + exact-normalized-plate arm ──────────────────── */

describe('searchVehicleHits query shape', () => {
  const vRow = (id: string, plate: string): Opts =>
    ({ id, plate, model: null, color: null, owner_id: null })

  it("normalized-plate arm crosses separators: 'ab-123' finds the stored 'AB123'", async () => {
    answerList((table, opts) => {
      if (table !== 'vehicles') return []
      // The plain ilike arm (plate/model/color) misses the separator-less
      // stored plate; the probe arm supplies the exact-match candidates.
      if (String(opts.or).includes('model.ilike')) return [vRow('v9', 'AB-999')]
      return [vRow('v1', 'AB123'), vRow('v2', 'ABX55')]
    })

    const hits = await searchVehicleHits('ab-123')
    const calls = listCalls().filter((c) => c.table === 'vehicles')
    // Plain arm: ilikeAny over the three visible columns, bounded.
    expect(calls[0].opts.or).toBe(ilikeAny(['plate', 'model', 'color'], 'ab-123'))
    expect(calls[0].opts).toMatchObject({ select: 'id,plate,model,color,owner_id', limit: 28 })
    // Probe arm: first two NORMALIZED chars, its own bound, client-filtered
    // on normPlate equality (mirroring the UNIQUE upper(plate) key).
    expect(calls[1].opts.or).toBe(ilikeAny(['plate'], 'AB'))
    expect(calls[1].opts.limit).toBe(50)

    // The exact normalized match ranks FIRST; the near-miss candidate (ABX55)
    // is dropped by the client filter, the plain-arm row follows.
    expect(hits.map((h) => h.id)).toEqual(['v1', 'v9'])
  })

  it('dedupes a plate found by both arms (exact position wins)', async () => {
    answerList((table) => table === 'vehicles' ? [vRow('v1', 'AB123')] : [])
    const hits = await searchVehicleHits('AB123')
    expect(hits.map((h) => h.id)).toEqual(['v1'])
  })
})

/* ── Accounts — normalized-handle arm ───────────────────────────────────── */

describe('searchAccountHits query shape', () => {
  const aRow = (id: string, handle: string, lifecycle = 'active'): Opts =>
    ({ id, platform: 'birdnet', handle, display_name: null, lifecycle })

  it("fires a second handle arm when normHandle differs: '@CoolGuy' finds 'coolguy'", async () => {
    answerList((table, opts) => {
      if (table !== 'accounts') return []
      // The raw arm ('@CoolGuy') matches nothing — the stored handle has no @.
      if (String(opts.or).includes('@')) return []
      return [aRow('a1', 'coolguy'), aRow('dead', 'coolguy_old', 'merged')]
    })
    const hits = await searchAccountHits('@CoolGuy')
    const calls = listCalls().filter((c) => c.table === 'accounts')
    expect(calls).toHaveLength(2)
    expect(calls[0].opts.or).toBe(ilikeAny(['handle', 'display_name', 'platform'], '@CoolGuy'))
    expect(calls[1].opts.or).toBe(ilikeAny(['handle'], 'coolguy'))
    // Merged accounts are tombstones — never offered.
    expect(hits.map((h) => h.label)).toEqual(['@coolguy'])
  })

  it('skips the second arm when the query is already normalized', async () => {
    await searchAccountHits('coolguy')
    expect(listCalls().filter((c) => c.table === 'accounts')).toHaveLength(1)
  })
})

/* ── Blank-query recent path (representative ilike kind) ────────────────── */

describe('blank-query recent path', () => {
  it('places: no or-filter, ordered updated_at desc, bounded, projected', async () => {
    await searchPlaceHits('')
    const call = listCalls().find((c) => c.table === 'places')!
    expect(call.opts.or).toBeUndefined()
    expect(call.opts).toMatchObject({
      select: 'id,name,type,area', order: 'updated_at', ascending: false, limit: 28,
    })
  })
})

/* ── Narcotics — merged_into tombstones and the typed RPC ───────────────── */

describe('searchNarcoticHits query shape', () => {
  it('blank query excludes merged rows at the query level (is merged_into null)', async () => {
    answerList((table) => table === 'narcotics'
      ? [{ id: 'n1', name: 'Redline', category: 'stimulant', status: 'active', restricted: true }]
      : [])
    const hits = await searchNarcoticHits('')
    const call = listCalls().find((c) => c.table === 'narcotics')!
    expect(call.opts).toMatchObject({
      is: { merged_into: null }, order: 'updated_at', ascending: false, limit: 28,
    })
    expect(hits[0].meta).toEqual({ restricted: 'true' })
  })

  it('queries go through the search_narcotics RPC, bounded', async () => {
    rpcMock.mockResolvedValue({
      data: [{ id: 'n1', name: 'Redline', category: 'stimulant', status: 'active', restricted: false, rank: 1, confidence: null }],
      error: null,
    } as never)
    const hits = await searchNarcoticHits('red')
    expect(rpcMock).toHaveBeenCalledWith('search_narcotics', { p_query: 'red', p_limit: 28 })
    expect(listMock).not.toHaveBeenCalled()
    expect(hits[0]).toMatchObject({ id: 'n1', meta: { restricted: 'false' } })
  })
})

/* ── Cross-kind invariants ──────────────────────────────────────────────── */

const DB_KINDS: EntityKind[] = [
  'person', 'vehicle', 'gang', 'place', 'account', 'case', 'operation', 'legal_request', 'narcotic',
]

describe('cross-kind invariants (every db-backed arm)', () => {
  it('every query is projected (no *, no email) and bounded (limit or id set)', async () => {
    rpcMock.mockResolvedValue({ data: [{ id: 'p1', rank: 1 }], error: null } as never)
    answerList((table) => table === 'persons'
      ? [{ id: 'p1', name: 'P', alias: null, dob: null, phone: null, status: null, gang_id: 'g1', mugshot_url: null, lifecycle: 'active' }]
      : [])
    for (const kind of DB_KINDS) await searchEntities(kind, 'delta')
    for (const kind of DB_KINDS) await searchEntities(kind, '')

    expect(listCalls().length).toBeGreaterThan(0)
    for (const { table, opts } of listCalls()) {
      const select = String(opts.select ?? '')
      // Projection discipline: an entity picker must never read '*' — and in
      // particular can never carry an email column (profiles email is
      // command-granted; persons has none, but the string ban is absolute).
      expect(select, `${table} projection`).toBeTruthy()
      expect(select).not.toContain('*')
      expect(select.toLowerCase()).not.toContain('email')
      // Bounded: an explicit limit, or an in:{id} hydration of an already
      // bounded id set (person/gang/owner lookups).
      expect(Boolean(opts.limit) || Boolean(opts.in), `${table} bounded`).toBe(true)
    }
    // Every or-disjunction is exactly an ilikeAny product: each clause is
    // col.ilike.*term* — user input can never smuggle extra conditions.
    for (const { opts } of listCalls()) {
      if (typeof opts.or !== 'string') continue
      for (const clause of opts.or.split(',')) {
        expect(clause).toMatch(/^[a-z_]+\.ilike\.\*[^,()]*\*$/)
      }
    }
    // RPC arms carry their own bound (limit + overfetch headroom).
    expect(rpcMock.mock.calls.length).toBeGreaterThan(0)
    for (const [fn, args] of rpcMock.mock.calls) {
      expect((args as Record<string, unknown>).p_limit, String(fn)).toBe(28)
    }
  })

  it('a transient failure degrades every async kind to [] — never a throw', async () => {
    listMock.mockRejectedValue(new Error('fetch failed'))
    rpcMock.mockResolvedValue({ data: null, error: { message: 'unavailable' } } as never)
    for (const kind of DB_KINDS) {
      await expect(searchEntities(kind, 'anything'), kind).resolves.toEqual([])
      await expect(searchEntities(kind, ''), kind).resolves.toEqual([])
    }
  })
})
