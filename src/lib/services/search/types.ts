/** Search adapter types (platform upgrade §5.1). Components import the
 *  adapter (`search-service`), never a provider: the exact path is the
 *  Postgres RPCs, the index path the `search-query` edge function
 *  (Meilisearch candidates re-authorized by `search_authorize`), the
 *  semantic path the `semantic-query` function (`hybrid_search` under the
 *  caller's JWT). Both functions answer 503 `{code:'unavailable'}` when
 *  their service is not configured — the adapter falls back to exact. */
import type { SearchHit } from '@/lib/search'

export type SearchMode = 'exact' | 'index' | 'semantic' | 'hybrid'

/** A hit from the edge functions / `hybrid_search` — normalised into the
 *  palette's SearchHit by the adapter. `highlight` is `ts_headline` text
 *  (`<b>…</b>` segments only); the palette renders it by SPLITTING the
 *  tags, never as HTML. */
export interface IndexHit {
  kind: string
  id: string
  case_id?: string | null
  page_no?: number | null
  title?: string | null
  snippet?: string | null
  score?: number | null
  mode?: string | null
}

export interface SearchResult {
  hits: SearchHit[]
  /** Which path produced the hits — the palette shows a subtle marker when a
   *  toggle's path was unavailable and the exact path answered instead. */
  mode: SearchMode
  /** The requested path answered "unavailable" (503) or failed; the exact
   *  path was used. Null when the requested path answered. */
  fallback: 'unavailable' | 'error' | null
}

/** A ranked list to merge: any object with an identity key. */
export interface RankedList<T> {
  items: readonly T[]
  key: (item: T) => string
}
