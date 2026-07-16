'use client'

/** Registry-only model for the Narcotics Intelligence workspace: the projected
 *  row shape, the category / status vocabularies (mirroring the DB CHECKs),
 *  neutral category artwork, aggregate rollups (alias + link counts), the
 *  category/filter/sort vocabulary, and Store persistence — all pure helpers so
 *  NarcoticsView stays orchestration and the model is unit-testable. */
import type { Tables } from '@/lib/database.types'
import { Store } from '@/lib/store'

type NarcoticRow = Tables<'narcotics'>

/** Registry projection — every column the cards + filters read. Deliberately
 *  excludes the heavy narrative columns (scene_indicators, officer_safety,
 *  intelligence_gaps, in_city_significance, charge_codes, …) so the browse
 *  fetch never ships them; the dossier fetches the full row itself. */
export const NARCOTIC_LIST_COLS =
  'id,name,classification,category,status,restricted,server_specific,confidence,' +
  'provenance,summary,appearance,packaging,icon,street_price,popularity,reviewed_at,' +
  'representative_media_id,merged_into,created_at,updated_at'

export type RegistryNarcotic = Pick<NarcoticRow,
  | 'id' | 'name' | 'classification' | 'category' | 'status' | 'restricted'
  | 'server_specific' | 'confidence' | 'provenance' | 'summary' | 'appearance'
  | 'packaging' | 'icon' | 'street_price' | 'popularity' | 'reviewed_at'
  | 'representative_media_id' | 'merged_into' | 'created_at' | 'updated_at'>

/* ---- Category vocabulary (mirrors narcotics_category_check) ---------------- */

export const NARCOTIC_CATEGORIES = [
  'cannabis', 'stimulant', 'opioid', 'sedative', 'hallucinogen', 'synthetic', 'unknown',
] as const

export const CATEGORY_LABELS: Record<string, string> = {
  cannabis: 'Cannabis', stimulant: 'Stimulants', opioid: 'Opioids', sedative: 'Sedatives',
  hallucinogen: 'Hallucinogens', synthetic: 'Synthetic', unknown: 'Unknown',
}
export const categoryLabel = (c: string | null | undefined): string => CATEGORY_LABELS[c ?? 'unknown'] ?? 'Unknown'

/** Neutral category artwork — a glyph shown when no representative image / icon
 *  exists. A non-colour signal always paired with the category label. */
export const CATEGORY_GLYPHS: Record<string, string> = {
  cannabis: '🌿', stimulant: '⚡', opioid: '💊', sedative: '🌙',
  hallucinogen: '🍄', synthetic: '🧪', unknown: '❓',
}
export const categoryGlyph = (c: string | null | undefined): string => CATEGORY_GLYPHS[c ?? 'unknown'] ?? '❓'

/** Category pill row (All first, then the DB vocabulary). */
export const CATEGORY_PILLS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'all', label: 'All' },
  ...NARCOTIC_CATEGORIES.map((c) => ({ value: c, label: categoryLabel(c) })),
]

/* ---- Status vocabulary (mirrors narcotics_status_check) -------------------- */

export const NARCOTIC_STATUSES = [
  'confirmed', 'reported', 'unidentified', 'suspected', 'disproven', 'archived', 'merged',
] as const

export const STATUS_LABELS: Record<string, string> = {
  confirmed: 'Confirmed', reported: 'Reported', unidentified: 'Unidentified',
  suspected: 'Suspected', disproven: 'Disproven', archived: 'Archived', merged: 'Merged',
}
export const statusLabel = (s: string | null | undefined): string => STATUS_LABELS[s ?? ''] ?? (s ?? '—')

/** Status → chip tint. confirmed = emerald, reported = blue, the provisional
 *  "unknown substance" states = amber, disproven = rose, archived/merged dim. */
export function narcoticStatusTint(status?: string | null): string {
  switch ((status ?? '').toLowerCase()) {
    case 'confirmed': return 'bg-emerald-500/15 text-emerald-300'
    case 'reported': return 'bg-blue-500/15 text-blue-300'
    case 'suspected':
    case 'unidentified': return 'bg-amber-500/15 text-amber-300'
    case 'disproven': return 'bg-rose-500/15 text-rose-300'
    case 'archived':
    case 'merged': return 'bg-white/5 text-slate-400'
    default: return 'bg-slate-500/20 text-slate-300'
  }
}

/** The working / unknown-substance states — surfaced as one "Provisional"
 *  metric + quick filter. */
export const PROVISIONAL_STATUSES: ReadonlySet<string> = new Set(['reported', 'unidentified', 'suspected'])

/** Catalog records turn stale slower than field intel — half a year. */
export const NARCOTIC_REVIEW_DAYS = 180

/** Stale = never reviewed, unparseable review date, or reviewed longer ago than
 *  the threshold. `now` injectable so this is deterministic in tests. */
export function isNarcoticStale(
  n: Pick<RegistryNarcotic, 'reviewed_at'>,
  now: number,
  thresholdDays = NARCOTIC_REVIEW_DAYS,
): boolean {
  if (!n.reviewed_at) return true
  const t = Date.parse(n.reviewed_at)
  if (Number.isNaN(t)) return true
  return (now - t) / 86_400_000 >= thresholdDays
}

/* ---- Aggregate rollups (one pass each — never per-card queries) ------------ */

/** narcotic_id → up to a handful of alias strings (display order preserved). */
export function buildAliasMap(rows: { narcotic_id: string; alias: string }[]): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const r of rows) {
    const arr = m.get(r.narcotic_id)
    if (arr) arr.push(r.alias)
    else m.set(r.narcotic_id, [r.alias])
  }
  return m
}

/** narcotic_id → count, from any of the link/seizure join tables. */
export function countByNarcotic(rows: { narcotic_id: string }[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows) m.set(r.narcotic_id, (m.get(r.narcotic_id) ?? 0) + 1)
  return m
}

export interface NarcoticStats {
  aliases: Map<string, string[]>
  personCounts: Map<string, number>
  placeCounts: Map<string, number>
  gangCounts: Map<string, number>
  seizureCounts: Map<string, number>
}

/* ---- Header metrics -------------------------------------------------------- */

export interface NarcoticMetricCounts {
  total: number
  confirmed: number
  provisional: number
  reviewDue: number
}

/** Rollup over the lifecycle-visible (non-merged) registry. */
export function buildNarcoticMetrics(rows: RegistryNarcotic[], now: number): NarcoticMetricCounts {
  let confirmed = 0, provisional = 0, reviewDue = 0
  for (const n of rows) {
    if (n.status === 'confirmed') confirmed++
    if (PROVISIONAL_STATUSES.has(n.status) || n.category === 'unknown') provisional++
    if (isNarcoticStale(n, now)) reviewDue++
  }
  return { total: rows.length, confirmed, provisional, reviewDue }
}

/* ---- Filters --------------------------------------------------------------- */

export interface NarcoticFilters {
  /** Exact status (empty = any). */
  status: string
  /** reported / unidentified / suspected. */
  provisional: boolean
  serverSpecific: boolean
  restricted: boolean
  reviewDue: boolean
}

export const EMPTY_NARCOTIC_FILTERS: NarcoticFilters = {
  status: '', provisional: false, serverSpecific: false, restricted: false, reviewDue: false,
}

/** Category + filters in one pass. Merged tombstones are never listed. */
export function applyNarcoticFilters(
  rows: RegistryNarcotic[],
  category: string,
  f: NarcoticFilters,
  now: number,
): RegistryNarcotic[] {
  return rows.filter((n) => {
    if (n.status === 'merged') return false
    if (category !== 'all' && n.category !== category) return false
    if (f.status && n.status !== f.status) return false
    if (f.provisional && !PROVISIONAL_STATUSES.has(n.status)) return false
    if (f.serverSpecific && !n.server_specific) return false
    if (f.restricted && !n.restricted) return false
    if (f.reviewDue && !isNarcoticStale(n, now)) return false
    return true
  })
}

/* ---- Sorting --------------------------------------------------------------- */

export const NARCOTIC_SORTS = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'reviewed', label: 'Last reviewed' },
  { value: 'staleness', label: 'Most stale first' },
  { value: 'popularity', label: 'Most prevalent' },
  { value: 'price', label: 'Street price' },
] as const
export type NarcoticSort = (typeof NARCOTIC_SORTS)[number]['value']

const ts = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isNaN(t) ? 0 : t
}

export function sortNarcotics(rows: RegistryNarcotic[], sort: NarcoticSort): RegistryNarcotic[] {
  const by = (cmp: (a: RegistryNarcotic, b: RegistryNarcotic) => number) =>
    rows.slice().sort((a, b) => cmp(a, b) || a.name.localeCompare(b.name))
  switch (sort) {
    case 'name': return rows.slice().sort((a, b) => a.name.localeCompare(b.name))
    case 'reviewed': return by((a, b) => ts(b.reviewed_at) - ts(a.reviewed_at))
    case 'staleness': return by((a, b) => ts(a.reviewed_at) - ts(b.reviewed_at)) // never-reviewed (0) first
    case 'popularity': return by((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
    case 'price': return by((a, b) => (Number(b.street_price) || 0) - (Number(a.street_price) || 0))
    case 'updated':
    default: return by((a, b) => ts(b.updated_at) - ts(a.updated_at))
  }
}

/* ---- Store persistence ----------------------------------------------------- */

export interface NarcoticView { category: string; sort: NarcoticSort }

const isCategory = (v: unknown): v is string =>
  v === 'all' || (typeof v === 'string' && (NARCOTIC_CATEGORIES as readonly string[]).includes(v))
const isSort = (v: unknown): v is NarcoticSort => NARCOTIC_SORTS.some((s) => s.value === v)

export function loadNarcoticView(): NarcoticView {
  const v = Store.get<Partial<NarcoticView>>('narcoticsView', {})
  return {
    category: isCategory(v.category) ? v.category : 'all',
    sort: isSort(v.sort) ? v.sort : 'updated',
  }
}
export const persistNarcoticView = (v: NarcoticView): void => Store.set('narcoticsView', v)

export function loadNarcoticFilters(): NarcoticFilters {
  const f = Store.get<Partial<NarcoticFilters>>('narcoticsFilters', {})
  return {
    status: typeof f.status === 'string' ? f.status : '',
    provisional: f.provisional === true,
    serverSpecific: f.serverSpecific === true,
    restricted: f.restricted === true,
    reviewDue: f.reviewDue === true,
  }
}
export const persistNarcoticFilters = (f: NarcoticFilters): void => Store.set('narcoticsFilters', f)
