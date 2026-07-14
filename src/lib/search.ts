/** Global search — wrapper over the `search_all` pg_trgm RPC (typo-tolerant,
 *  relevance-ranked, SECURITY INVOKER so every row is RLS-scoped to the
 *  caller). Port of the vanilla deep search + Cmd-K palette data sources
 *  (app.js supaSearch/paletteSources). Charges are static reference data and
 *  are matched client-side against the penal catalog, exactly like vanilla. */
import { rpc } from './db'
import { PENAL_CODE, penalSentence, type PenalCharge } from './penal'
import { Store } from './store'

export interface SearchHit {
  kind: string
  id: string
  label: string
  sublabel: string | null
  /** Prefill term for views that seed their filter input from `?q=`. */
  term: string | null
  rank: number
}

/** Section metadata per result kind: display order, heading, icon, and the
 *  destination tab. Kinds arrive from the RPC; charges are added locally. */
export const SEARCH_KINDS: Record<string, { title: string; icon: string; tab: string }> = {
  case:      { title: 'Cases',      icon: '📁', tab: 'cases' },
  report:    { title: 'Reports',    icon: '📝', tab: 'cases' },
  evidence:  { title: 'Evidence',   icon: '🧾', tab: 'cases' },
  operation: { title: 'Operations', icon: '🎯', tab: 'operations' },
  legal:     { title: 'Legal Requests', icon: '⚖️', tab: 'legal' },
  person:    { title: 'Persons',    icon: '👤', tab: 'persons' },
  gang:      { title: 'Gangs',      icon: '🚩', tab: 'gangs' },
  place:     { title: 'Places',     icon: '📍', tab: 'places' },
  vehicle:   { title: 'Vehicles',   icon: '🚗', tab: 'vehicles' },
  narcotic:  { title: 'Narcotics',  icon: '💊', tab: 'narcotics' },
  bench:     { title: 'Ballistics', icon: '🔫', tab: 'ballistics' },
  footprint: { title: 'Ballistics', icon: '🧬', tab: 'ballistics' },
  document:  { title: 'Documents',  icon: '📄', tab: 'sops' },
  charge:    { title: 'Charges',    icon: '⚖️', tab: 'penal' },
}

export const SEARCH_SECTION_ORDER = ['case', 'report', 'evidence', 'operation', 'legal', 'person', 'gang', 'place', 'vehicle', 'narcotic', 'bench', 'document', 'charge'] as const

/** Charges matched client-side from the in-memory penal catalog (vanilla
 *  app.js:330) — they are static reference data, not RLS-scoped rows. */
export function chargeHits(q: string, max = 6): SearchHit[] {
  const ql = q.trim().toLowerCase()
  if (!ql) return []
  const hay = (c: PenalCharge) => `${c.code} ${c.title} ${c.level} ${c.desc ?? ''}`.toLowerCase()
  return PENAL_CODE.filter((c) => hay(c).includes(ql))
    .slice(0, max)
    .map((c) => ({
      kind: 'charge',
      id: c.code,
      label: `${c.code} · ${c.title}`,
      sublabel: `${c.level} · ${penalSentence(c.jail)}`,
      term: c.code,
      rank: 0.5,
    }))
}

/** One round-trip cross-entity search. Returns hits sorted by rank within
 *  their kind (the RPC caps at 8 per kind / 60 total). Throws on RPC error so
 *  the palette can show a real failure state instead of "no matches". */
export async function runSearch(q: string): Promise<SearchHit[]> {
  const query = q.trim()
  if (!query) return []
  const res = await rpc('search_all', { q: query })
  if (res.error) throw new Error(res.error.message)
  const rows = (res.data ?? []) as SearchHit[]
  return rows.concat(chargeHits(query))
}

/** Recent-search memory — same Store key + shape as vanilla (deduped,
 *  most-recent first, capped at 8) so history survives cutover. */
export function recentSearches(): string[] {
  return Store.get<string[]>('recentSearches', [])
}

export function rememberSearch(q: string): void {
  const query = q.trim()
  if (!query) return
  const next = [query, ...recentSearches().filter((x) => x.toLowerCase() !== query.toLowerCase())].slice(0, 8)
  Store.set('recentSearches', next)
}
