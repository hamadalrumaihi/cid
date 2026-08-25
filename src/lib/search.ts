/** Global search — wrapper over the `search_all` pg_trgm RPC (typo-tolerant,
 *  relevance-ranked, SECURITY INVOKER so every row is RLS-scoped to the
 *  caller). Port of the vanilla deep search + Cmd-K palette data sources
 *  (app.js supaSearch/paletteSources). Charges are static reference data and
 *  are matched client-side against the penal catalog, exactly like vanilla. */
import { rpc } from './db'
import { searchSubmissions } from './fieldReview'
import { REVIEW_STATUS_LABEL } from './legalWorkflow'
import { penalCatalog, penalSentence, type PenalCharge } from './penal'
import { activeProfiles } from './profiles'
import { bureauShort, roleLabel } from './roles'
import { statusMeta } from './status'
import { Store } from './store'

export interface SearchHit {
  kind: string
  id: string
  label: string
  sublabel: string | null
  /** Prefill term for views that seed their filter input from `?q=`.
   *  (For `task` hits the RPC repurposes it to carry the TASK id — the row
   *  id column carries the parent CASE id, like the report/evidence arms.) */
  term: string | null
  rank: number
}

/** Section metadata per result kind: display order, heading, destination tab
 *  and the short per-row tag the palette right-aligns on each result. Kinds
 *  arrive from the RPC; charges / members / intel tips are added locally. The
 *  glyph for each kind lives with the icon set (shell/icons KindIcon), not
 *  here. */
export const SEARCH_KINDS: Record<string, { title: string; tab: string; tag: string }> = {
  case:      { title: 'Cases',      tab: 'cases',      tag: 'case' },
  report:    { title: 'Reports',    tab: 'cases',      tag: 'report' },
  task:      { title: 'Case Tasks', tab: 'cases',      tag: 'task' },
  evidence:  { title: 'Evidence',   tab: 'cases',      tag: 'evidence' },
  operation: { title: 'Operations', tab: 'operations', tag: 'operation' },
  legal:     { title: 'Legal Requests', tab: 'legal',  tag: 'legal' },
  person:    { title: 'Persons',    tab: 'persons',    tag: 'person' },
  bolo:      { title: 'BOLOs',      tab: 'persons',    tag: 'BOLO' },
  gang:      { title: 'Gangs',      tab: 'gangs',      tag: 'gang' },
  place:     { title: 'Places',     tab: 'places',     tag: 'place' },
  vehicle:   { title: 'Vehicles',   tab: 'vehicles',   tag: 'vehicle' },
  account:   { title: 'Accounts',   tab: 'accounts',   tag: 'account' },
  narcotic:  { title: 'Narcotics',  tab: 'narcotics',  tag: 'narcotic' },
  bench:     { title: 'Ballistics', tab: 'ballistics', tag: 'ballistics' },
  footprint: { title: 'Ballistics', tab: 'ballistics', tag: 'ballistics' },
  document:  { title: 'Documents',  tab: 'sops',       tag: 'document' },
  tip:       { title: 'Intelligence', tab: 'field-review', tag: 'intel' },
  member:    { title: 'Members',    tab: 'personnel',  tag: 'member' },
  charge:    { title: 'Charges',    tab: 'penal',      tag: 'charge' },
}

export const SEARCH_SECTION_ORDER = ['case', 'report', 'task', 'evidence', 'operation', 'legal', 'person', 'bolo', 'gang', 'place', 'vehicle', 'account', 'narcotic', 'bench', 'document', 'tip', 'member', 'charge'] as const

/** Charges matched client-side from the cached penal catalog. The catalog is
 *  the PUBLISHED penal code, fetched once by `ensurePenalCode()`; before it
 *  arrives this returns nothing, which is right — a search should surface no
 *  charge rather than guess at one. */
export function chargeHits(q: string, max = 6): SearchHit[] {
  const ql = q.trim().toLowerCase()
  if (!ql) return []
  const hay = (c: PenalCharge) => `${c.code} ${c.title} ${c.level} ${c.desc ?? ''}`.toLowerCase()
  return penalCatalog().filter((c) => hay(c).includes(ql))
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

/** Division members matched client-side against the shared roster cache
 *  (useProfilesStore — the non-email projection; email is command-granted and
 *  is deliberately never part of the haystack). Same pattern as chargeHits:
 *  before the cache arrives this returns nothing rather than guessing. */
export function memberHits(q: string, max = 6): SearchHit[] {
  const ql = q.trim().toLowerCase()
  if (!ql) return []
  return activeProfiles()
    .filter((p) => `${p.display_name ?? ''} ${p.badge_number ?? ''} ${roleLabel(p.role)}`.toLowerCase().includes(ql))
    .slice(0, max)
    .map((p) => ({
      kind: 'member',
      id: p.id,
      label: p.display_name || 'Officer',
      sublabel: `${roleLabel(p.role)} · ${bureauShort(p.division)}`,
      term: p.display_name,
      rank: 0.4,
    }))
}

/** Intel-submission matches → palette hits. `field_submission_search` returns
 *  only (submission_id, matched[]) — every hit is readability-guarded server
 *  side, and no title travels — so the row says WHAT matched ("a person, the
 *  thread") rather than pretending to know the report's summary. */
export function tipHitsFromMatches(matches: ReadonlyMap<string, string[]>, max = 6): SearchHit[] {
  return [...matches.entries()].slice(0, max).map(([id, matched]) => ({
    kind: 'tip',
    id,
    label: 'Intelligence report',
    sublabel: matched.length ? `Matched ${matched.join(', ')}` : null,
    term: null,
    rank: 0.4,
  }))
}

/** The RPC's bolo sublabel is `'BOLO · ' || bolo_risk [|| ' · expired']` with
 *  the risk token verbatim (lowercase, possibly empty). Re-case the risk
 *  through the central status registry ("BOLO · High · expired") and drop an
 *  empty segment when the flag has no risk set. Pure and lossless — a shape
 *  this doesn't recognise passes through unchanged. */
export function boloHitSublabel(sublabel: string | null): string | null {
  if (!sublabel) return sublabel
  const parts = sublabel.split(' · ')
  if (parts[0] !== 'BOLO') return sublabel
  const out = ['BOLO']
  if (parts[1]?.trim()) out.push(statusMeta('boloRisk', parts[1].trim()).label)
  for (const rest of parts.slice(2)) if (rest.trim()) out.push(rest.trim())
  return out.join(' · ')
}

/** The RPC's legal sublabel is `initcap(request_type) · replace(review_status,
 *  '_', ' ')` — a machine status with the underscores swapped, not the model's
 *  vocabulary. Re-derive the workflow model's human label from that token so
 *  search rows read like every other legal surface ("Warrant · Submitted to
 *  DOJ — awaiting assignment", never "submitted to doj"). Pure and lossless:
 *  an unrecognised token passes through unchanged; the RPC itself (RLS-scoped,
 *  sealed-safe) is untouched. */
export function legalHitSublabel(sublabel: string | null): string | null {
  if (!sublabel) return sublabel
  const sep = sublabel.indexOf(' · ')
  if (sep < 0) return sublabel
  const head = sublabel.slice(0, sep)
  const token = sublabel.slice(sep + 3).trim().replace(/ /g, '_').toLowerCase()
  const label = REVIEW_STATUS_LABEL[token]
  return label ? `${head} · ${label}` : sublabel
}

/** One round-trip cross-entity search (plus the intel-submission RPC in
 *  parallel — its failure degrades to "no tips" and never kills the search).
 *  Returns hits sorted by rank within their kind (the RPC caps at 8 per kind
 *  / 60 total). Throws on search_all error so the palette can show a real
 *  failure state instead of "no matches". */
export async function runSearch(q: string): Promise<SearchHit[]> {
  const query = q.trim()
  if (!query) return []
  const [res, tips] = await Promise.all([
    rpc('search_all', { q: query }),
    // SECURITY DEFINER but readability-guarded per row; min 2 chars enforced
    // inside searchSubmissions. Tolerate failure — tips are additive.
    searchSubmissions(query).catch(() => new Map<string, string[]>()),
  ])
  if (res.error) throw new Error(res.error.message)
  const rows = (res.data ?? []) as SearchHit[]
  return rows
    .map((h) => (
      h.kind === 'legal' ? { ...h, sublabel: legalHitSublabel(h.sublabel) }
      : h.kind === 'bolo' ? { ...h, sublabel: boloHitSublabel(h.sublabel) }
      : h))
    .concat(chargeHits(query))
    .concat(memberHits(query))
    .concat(tipHitsFromMatches(tips))
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
