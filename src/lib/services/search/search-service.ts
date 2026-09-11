/** Search adapter (platform upgrade §5.1). ONE entry for the palette:
 *
 *    exact(q)     — `runSearch` (search_all + tips + CI when involved) in
 *                   parallel with `document_search` and
 *                   `external_source_search`; the two FTS RPCs are additive
 *                   (a failure contributes nothing, never kills the search).
 *    index(q)     — the `search-query` edge function (Meilisearch candidates
 *                   re-authorized by `search_authorize` under the caller's
 *                   JWT) — only when flag `meilisearch` is on; null otherwise
 *                   or when the function answers 503 `{code:'unavailable'}`.
 *    semantic(q)  — the `semantic-query` function (`hybrid_search` under the
 *                   caller's JWT) — only when flag `semantic_search` is on;
 *                   null on 503 / error.
 *    hybrid(q)    — exact + semantic merged client-side by reciprocal rank
 *                   fusion (`rrfMerge`, k = 60); falls back to exact.
 *    search(q)    — what the palette calls: exact, plus index when flagged,
 *                   plus semantic when the toggle is on and flagged.
 *
 *  CI rules (audit/search-graph §1, 1–8) are untouched: `ci_search` is
 *  issued only through `runSearch` with `opts.ci`, no index or semantic path
 *  ever names a CI kind (the index builder excludes them server-side, and
 *  `normaliseIndexHit` drops anything it does not recognise), and no hit
 *  reaches recents from here (the palette decides that).
 *
 *  Nothing here widens access: every RPC is SECURITY INVOKER, both functions
 *  run the search RPCs under the caller's JWT, and a hit without a readable
 *  row never exists. */
import { caseLink } from '@/lib/caseLinks'
import { invokeFunctionJson, rpc } from '@/lib/db'
import { flagOn } from '@/lib/flags'
import {
  documentHitsFromRows, headlineText, runSearch, sourceHitsFromRows,
  type DocumentSearchRow, type SearchHit, type SourceSearchRow,
} from '@/lib/search'
import type { IndexHit, RankedList, SearchMode, SearchResult } from './types'

const FTS_LIMIT = 8

/** Reciprocal rank fusion: score(item) = Σ over lists containing the item's
 *  key of 1 / (k + rank), rank 1-based. Items are deduped by key (the FIRST
 *  occurrence's object is kept), sorted by fused score descending; ties keep
 *  the order of first appearance. Pure. */
export function rrfMerge<T>(lists: ReadonlyArray<RankedList<T>>, k = 60): Array<{ item: T; score: number }> {
  const scores = new Map<string, { item: T; score: number; order: number }>()
  let order = 0
  for (const list of lists) {
    list.items.forEach((item, i) => {
      const key = list.key(item)
      const add = 1 / (k + i + 1)
      const cur = scores.get(key)
      if (cur) cur.score += add
      else scores.set(key, { item, score: add, order: order++ })
    })
  }
  return [...scores.values()]
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.order - b.order))
    .map(({ item, score }) => ({ item, score }))
}

/** Identity of a hit for merging: kind + id (document page ids already
 *  carry the page). */
export const hitKey = (h: SearchHit): string => `${h.kind}:${h.id}`

/** Merge ranked hit lists into one hit list, stamping the fused score onto
 *  `rank` so sections stay ordered by fusion. */
export function mergeHits(lists: ReadonlyArray<readonly SearchHit[]>, k = 60): SearchHit[] {
  return rrfMerge(lists.map((items) => ({ items, key: hitKey })), k).map(({ item, score }) => ({ ...item, rank: score }))
}

/** The index / hybrid kinds the palette knows how to route. Anything else
 *  (a future kind, or a stray value) is dropped — never rendered blind. */
const INDEX_KINDS = new Set(['document_page', 'external_source', 'report'])

/** One function hit → a palette hit, or null when unroutable. `document_page`
 *  hits need a case (the Documents tab); `report` hits need a case (the
 *  Reports tab); sources route by id. Labels come from the authorized hit
 *  (`title` / `label`), never from the raw index document. */
export function normaliseIndexHit(raw: unknown): SearchHit | null {
  if (!raw || typeof raw !== 'object') return null
  const h = raw as IndexHit & { label?: string | null; highlight?: string | null; media_id?: string | null; page?: number | null }
  const kind = typeof h.kind === 'string' ? h.kind : ''
  if (!INDEX_KINDS.has(kind)) return null
  const id = typeof h.id === 'string' && h.id ? h.id : (typeof h.media_id === 'string' ? h.media_id : '')
  if (!id) return null
  const caseId = typeof h.case_id === 'string' && h.case_id ? h.case_id : null
  const page = typeof h.page_no === 'number' ? h.page_no : typeof h.page === 'number' ? h.page : null
  const headline = typeof h.snippet === 'string' ? h.snippet : typeof h.highlight === 'string' ? h.highlight : null
  const text = headlineText(headline)
  const title = (typeof h.title === 'string' && h.title) || (typeof h.label === 'string' && h.label) || ''
  const score = typeof h.score === 'number' ? h.score : 0
  if (kind === 'document_page') {
    if (!caseId) return null
    return {
      kind: 'document_page', id: page !== null ? `${id}:${page}` : id, label: title || 'Document',
      sublabel: page !== null ? (text ? `Page ${page} · ${text}` : `Page ${page}`) : (text || null),
      headline, term: null, rank: score,
      href: caseLink(caseId, 'documents', { media: id, ...(page !== null ? { page } : {}) }),
    }
  }
  if (kind === 'external_source') {
    return {
      kind: 'source', id, label: title || 'External source', sublabel: text || null, headline, term: null, rank: score,
      href: `/intelligence?source=${encodeURIComponent(id)}`,
    }
  }
  // report — the palette's report kind carries the CASE id and opens the
  // Reports tab; an index hit knows the report itself, so link it directly.
  if (!caseId) return null
  return {
    kind: 'report', id: caseId, label: title || 'Report', sublabel: text || null, headline, term: null, rank: score,
    href: caseLink(caseId, 'reports', { report: id }),
  }
}

type FnAnswer = { hits?: unknown; rows?: unknown } | unknown[] | null

const hitsOf = (data: FnAnswer): unknown[] => {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object') {
    const d = data as { hits?: unknown; rows?: unknown }
    if (Array.isArray(d.hits)) return d.hits
    if (Array.isArray(d.rows)) return d.rows
  }
  return []
}

/** Call one query function. `null` = unavailable (flag off, 503, or any
 *  failure) — the caller falls back; the reason rides on `why`. */
async function queryFunction(name: 'search-query' | 'semantic-query', body: Record<string, unknown>): Promise<{ hits: SearchHit[] | null; why: 'unavailable' | 'error' | null }> {
  const res = await invokeFunctionJson<FnAnswer>(name, body)
  if (res.error) return { hits: null, why: res.status === 503 || res.error.code === 'unavailable' ? 'unavailable' : 'error' }
  const hits = hitsOf(res.data).map(normaliseIndexHit).filter((h): h is SearchHit => !!h)
  return { hits, why: null }
}

export interface SearchOptions {
  /** The palette passes `ciInvolved(ctx)` — `ci_search` fires only then. */
  ci?: boolean
  /** The "Semantic" toggle (only offered when flag `semantic_search` is on). */
  semantic?: boolean
  limit?: number
}

export const SearchService = {
  /** Exact path: the historical search plus the two FTS RPCs. Throws only
   *  when `search_all` itself fails (runSearch's contract). */
  async exact(q: string, opts: Pick<SearchOptions, 'ci' | 'limit'> = {}): Promise<SearchHit[]> {
    const query = q.trim()
    if (!query) return []
    const limit = opts.limit ?? FTS_LIMIT
    const [base, docs, sources] = await Promise.all([
      runSearch(query, { ci: opts.ci }),
      rpc('document_search', { p_q: query, p_limit: limit })
        .then((r) => (r.error ? [] : ((r.data ?? []) as DocumentSearchRow[])))
        .catch(() => [] as DocumentSearchRow[]),
      rpc('external_source_search', { p_q: query, p_limit: limit })
        .then((r) => (r.error ? [] : ((r.data ?? []) as SourceSearchRow[])))
        .catch(() => [] as SourceSearchRow[]),
    ])
    return base.concat(documentHitsFromRows(docs, limit)).concat(sourceHitsFromRows(sources, limit))
  },

  /** Index path — null when the flag is off or the function is unavailable. */
  async index(q: string, opts: Pick<SearchOptions, 'limit'> = {}): Promise<SearchHit[] | null> {
    const query = q.trim()
    if (!query || !flagOn('meilisearch')) return null
    return (await queryFunction('search-query', { q: query, limit: opts.limit ?? 20 })).hits
  },

  /** Semantic path — null when the flag is off or the function is unavailable. */
  async semantic(q: string, opts: Pick<SearchOptions, 'limit'> = {}): Promise<SearchHit[] | null> {
    const query = q.trim()
    if (!query || !flagOn('semantic_search')) return null
    return (await queryFunction('semantic-query', { q: query, limit: opts.limit ?? 20 })).hits
  },

  /** Exact + semantic fused by RRF; exact alone when semantic is unavailable. */
  async hybrid(q: string, opts: Pick<SearchOptions, 'ci' | 'limit'> = {}): Promise<SearchResult> {
    return SearchService.search(q, { ...opts, semantic: true })
  },

  /** The palette's entry: exact always; index when flagged; semantic when
   *  asked and flagged. Fused when more than one path answered. */
  async search(q: string, opts: SearchOptions = {}): Promise<SearchResult> {
    const query = q.trim()
    if (!query) return { hits: [], mode: 'exact', fallback: null }
    const wantIndex = flagOn('meilisearch')
    const wantSemantic = !!opts.semantic && flagOn('semantic_search')
    const [exact, index, semantic] = await Promise.all([
      SearchService.exact(query, opts),
      wantIndex ? queryFunction('search-query', { q: query, limit: opts.limit ?? 20 }) : Promise.resolve({ hits: null, why: null } as const),
      wantSemantic ? queryFunction('semantic-query', { q: query, limit: opts.limit ?? 20 }) : Promise.resolve({ hits: null, why: null } as const),
    ])
    const lists: SearchHit[][] = [exact]
    if (index.hits) lists.push(index.hits)
    if (semantic.hits) lists.push(semantic.hits)
    const mode: SearchMode = semantic.hits ? 'hybrid' : index.hits ? 'index' : 'exact'
    const fallback = (wantSemantic && !semantic.hits ? semantic.why : null) ?? (wantIndex && !index.hits ? index.why : null)
    return { hits: lists.length > 1 ? mergeHits(lists) : exact, mode, fallback }
  },
}
