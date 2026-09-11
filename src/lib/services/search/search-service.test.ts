/** Search adapter pins (platform upgrade §5.1): reciprocal rank fusion,
 *  the index-hit normaliser (routes only what the palette knows, never a CI
 *  kind), the flag gates and the 503 / error fallback to the exact path. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchHit } from '@/lib/search'

const db = vi.hoisted(() => ({
  rpc: vi.fn(),
  invokeFunctionJson: vi.fn(),
}))
const flags = vi.hoisted(() => ({ on: new Set<string>() }))
const base = vi.hoisted(() => ({ runSearch: vi.fn() }))

vi.mock('@/lib/db', () => ({ rpc: db.rpc, invokeFunctionJson: db.invokeFunctionJson }))
vi.mock('@/lib/flags', () => ({ flagOn: (k: string) => flags.on.has(k) }))
vi.mock('@/lib/search', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/search')>()
  return { ...mod, runSearch: base.runSearch }
})

import { SearchService, hitKey, mergeHits, normaliseIndexHit, rrfMerge } from './search-service'

const hit = (kind: string, id: string, label = id): SearchHit => ({ kind, id, label, sublabel: null, term: null, rank: 1 })
const C = '11111111-2222-4333-8444-555555555555'
const M = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

beforeEach(() => {
  flags.on.clear()
  db.rpc.mockReset()
  db.invokeFunctionJson.mockReset()
  base.runSearch.mockReset()
  base.runSearch.mockResolvedValue([hit('case', 'c1', 'Dockside')])
  db.rpc.mockImplementation(async (fn: string) => {
    if (fn === 'document_search') return { data: [{ media_id: M, case_id: C, title: 'Lease', evidence_number: 'EV-000004', page_no: 3, headline: 'the <b>dock</b> lease', rank: 0.4 }], error: null }
    if (fn === 'external_source_search') return { data: [{ source_id: 's1', source_number: 'SRC-000001', title: 'Port notice', domain: 'example.org', headline: '<b>dock</b> closed', rank: 0.3 }], error: null }
    return { data: null, error: { message: `unexpected ${fn}` } }
  })
})

describe('rrfMerge', () => {
  it('fuses ranks with k = 60, dedupes by key and keeps the first object', () => {
    const a = { items: ['x', 'y', 'z'], key: (s: string) => s }
    const b = { items: ['y', 'w'], key: (s: string) => s }
    const out = rrfMerge([a, b])
    // y: 1/62 + 1/61 · x: 1/61 · w: 1/62 · z: 1/63
    expect(out.map((o) => o.item)).toEqual(['y', 'x', 'w', 'z'])
    expect(out[0].score).toBeCloseTo(1 / 62 + 1 / 61, 10)
    expect(out[3].score).toBeCloseTo(1 / 63, 10)
  })

  it('breaks ties by first appearance and honours a custom k', () => {
    const a = { items: ['p'], key: (s: string) => s }
    const b = { items: ['q'], key: (s: string) => s }
    expect(rrfMerge([a, b], 10).map((o) => o.item)).toEqual(['p', 'q'])
    expect(rrfMerge([a, b], 10)[0].score).toBeCloseTo(1 / 11, 10)
    expect(rrfMerge([])).toEqual([])
  })

  it('mergeHits keys on kind:id and stamps the fused score onto rank', () => {
    const exact = [hit('person', 'p1'), hit('case', 'c1')]
    const sem = [hit('case', 'c1'), hit('source', 's1')]
    const out = mergeHits([exact, sem])
    expect(out.map(hitKey)).toEqual(['case:c1', 'person:p1', 'source:s1'])
    expect(out[0].rank).toBeGreaterThan(out[1].rank)
  })
})

describe('normaliseIndexHit', () => {
  it('routes document pages, sources and reports; drops everything else', () => {
    expect(normaliseIndexHit({ kind: 'document_page', id: M, case_id: C, page_no: 2, title: 'Lease', snippet: 'a <b>b</b>' })).toMatchObject({
      kind: 'document_page', id: `${M}:2`, label: 'Lease', sublabel: 'Page 2 · a b',
      href: `/cases?case=${C}&tab=documents&media=${M}&page=2`,
    })
    expect(normaliseIndexHit({ kind: 'external_source', id: 's1', title: 'SRC-000001 · Port', snippet: null })).toMatchObject({
      kind: 'source', href: '/intelligence?source=s1',
    })
    expect(normaliseIndexHit({ kind: 'report', id: 'r1', case_id: C, title: 'Arrest report' })).toMatchObject({
      kind: 'report', id: C, href: `/cases?case=${C}&tab=reports&report=r1`,
    })
    // No case → no route for a page / report; unknown kinds (incl. any CI
    // spelling) never surface.
    expect(normaliseIndexHit({ kind: 'document_page', id: M })).toBeNull()
    expect(normaliseIndexHit({ kind: 'report', id: 'r1' })).toBeNull()
    expect(normaliseIndexHit({ kind: 'ci', id: 'x', case_id: C })).toBeNull()
    expect(normaliseIndexHit({ kind: 'confidential_informant', id: 'x' })).toBeNull()
    expect(normaliseIndexHit(null)).toBeNull()
  })
})

describe('SearchService', () => {
  it('exact = runSearch + document_search + external_source_search, CI only when asked', async () => {
    const hits = await SearchService.exact('dock', { ci: true })
    expect(base.runSearch).toHaveBeenCalledWith('dock', { ci: true })
    expect(hits.map((h) => h.kind)).toEqual(['case', 'document_page', 'source'])
    expect(hits[1]).toMatchObject({ label: 'Lease · EV-000004', sublabel: 'Page 3 · the dock lease', href: `/cases?case=${C}&tab=documents&media=${M}&page=3` })
    expect(hits[2]).toMatchObject({ label: 'SRC-000001 · Port notice', sublabel: 'example.org · dock closed', href: '/intelligence?source=s1' })
    await SearchService.exact('dock')
    expect(base.runSearch).toHaveBeenLastCalledWith('dock', { ci: undefined })
  })

  it('a failing FTS RPC contributes nothing and never kills the search', async () => {
    db.rpc.mockImplementation(async (fn: string) => (fn === 'document_search' ? { data: null, error: { message: 'boom' } } : { data: [], error: null }))
    const hits = await SearchService.exact('dock')
    expect(hits.map((h) => h.kind)).toEqual(['case'])
  })

  it('index / semantic are null when their flag is off — the function is never invoked', async () => {
    expect(await SearchService.index('dock')).toBeNull()
    expect(await SearchService.semantic('dock')).toBeNull()
    const r = await SearchService.search('dock', { semantic: true })
    expect(r).toMatchObject({ mode: 'exact', fallback: null })
    expect(db.invokeFunctionJson).not.toHaveBeenCalled()
  })

  it('a 503 {code:unavailable} falls back to exact and reports it', async () => {
    flags.on.add('semantic_search')
    db.invokeFunctionJson.mockResolvedValue({ data: null, error: { message: 'unavailable', code: 'unavailable' }, status: 503 })
    const r = await SearchService.search('dock', { semantic: true })
    expect(db.invokeFunctionJson).toHaveBeenCalledWith('semantic-query', { q: 'dock', limit: 20 })
    expect(r.mode).toBe('exact')
    expect(r.fallback).toBe('unavailable')
    expect(r.hits.map((h) => h.kind)).toEqual(['case', 'document_page', 'source'])
  })

  it('a function error also falls back (reason "error")', async () => {
    flags.on.add('meilisearch')
    db.invokeFunctionJson.mockResolvedValue({ data: null, error: { message: 'timeout' }, status: null })
    const r = await SearchService.search('dock')
    expect(db.invokeFunctionJson).toHaveBeenCalledWith('search-query', { q: 'dock', limit: 20 })
    expect(r).toMatchObject({ mode: 'exact', fallback: 'error' })
  })

  it('hybrid merges exact and semantic hits by RRF', async () => {
    flags.on.add('semantic_search')
    db.invokeFunctionJson.mockResolvedValue({
      data: { hits: [
        { kind: 'document_page', id: M, case_id: C, page_no: 3, title: 'Lease', snippet: 'dock', score: 0.9 },
        { kind: 'external_source', id: 's9', title: 'SRC-000009', score: 0.5 },
        { kind: 'ci', id: 'never', case_id: C },
      ] },
      error: null, status: 200,
    })
    const r = await SearchService.hybrid('dock')
    expect(r.mode).toBe('hybrid')
    expect(r.fallback).toBeNull()
    // The page hit appears in both lists → fused to the top; the CI-shaped
    // row is dropped by the normaliser; s9 (semantic rank 2 → 1/62) lands
    // above s1 (exact rank 3 → 1/63).
    expect(r.hits[0]).toMatchObject({ kind: 'document_page', id: `${M}:3` })
    expect(r.hits.map(hitKey)).toEqual([`document_page:${M}:3`, 'case:c1', 'source:s9', 'source:s1'])
    expect(r.hits.some((h) => h.kind === 'ci')).toBe(false)
  })

  it('a blank query short-circuits without touching the network', async () => {
    expect(await SearchService.search('   ')).toEqual({ hits: [], mode: 'exact', fallback: null })
    expect(base.runSearch).not.toHaveBeenCalled()
  })
})
