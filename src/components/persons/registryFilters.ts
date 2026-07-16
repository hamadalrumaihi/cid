'use client'

/** Registry-only model for the Persons of Interest workspace: the projected
 *  row shape, aggregate rollups (case/vehicle/warrant counts, duplicate
 *  clusters), the filter + sort vocabulary, and Store persistence — all pure
 *  helpers so PersonsView stays orchestration. Intelligence semantics
 *  (staleness, BOLO state, active-warrant rules, duplicate detection) come
 *  from ./personIntel; this file only wires them into the filter model. */
import type { Tables } from '@/lib/database.types'
import { Store } from '@/lib/store'
import {
  boloState, classificationLabel, confidenceLabel, findDuplicatePersons,
  isLegalActive, lifecycleLabel, reviewDueState, type LegalLite,
} from './personIntel'

type PersonRow = Tables<'persons'>

/** Registry projection — every column the cards, the table, and the edit
 *  modal read (a superset of personIntel's PersonRowLike). Deliberately
 *  excludes the heavy/irrelevant columns (intelligence_summary, review_note,
 *  reviewed_by, created_by, bolo_issued_by/at, bolo_case_id) so the browse
 *  fetch never ships them. */
export const PERSON_LIST_COLS =
  'id,name,alias,dob,phone,status,classification,confidence,priority,lifecycle,' +
  'bolo,bolo_reason,bolo_risk,bolo_instructions,bolo_expires_at,gang_id,mugshot_url,' +
  'felony_count,vch,ccw,notes,identity,properties,reviewed_at,next_review_at,' +
  'lead_detective_id,merged_into,updated_at,created_at'

export type RegistryPerson = Pick<PersonRow,
  | 'id' | 'name' | 'alias' | 'dob' | 'phone' | 'status' | 'classification' | 'confidence'
  | 'priority' | 'lifecycle' | 'bolo' | 'bolo_reason' | 'bolo_risk' | 'bolo_instructions'
  | 'bolo_expires_at' | 'gang_id' | 'mugshot_url' | 'felony_count' | 'vch' | 'ccw' | 'notes'
  | 'identity' | 'properties' | 'reviewed_at' | 'next_review_at' | 'lead_detective_id'
  | 'merged_into' | 'updated_at' | 'created_at'>

/** Stale for registry purposes = anything but 'fresh': never reviewed, past
 *  its scheduled next_review_at, or last reviewed 90+ days ago. */
export const isStaleRecord = (
  p: Pick<RegistryPerson, 'reviewed_at' | 'next_review_at'>,
  now: number,
): boolean => reviewDueState(p, now) !== 'fresh'

/* ---- Aggregate rollups (one pass each — never per-card queries) ----------- */

/** The projected legal_requests slice the registry fetches — personIntel's
 *  LegalLite (workflow columns only, no narrative) plus the person pointer. */
export type WarrantLite = LegalLite & { person_id: string | null }
/** The matching select for list('legal_requests', …). */
export const LEGAL_LITE_COLS =
  'id,person_id,request_type,subtype,review_status,fulfilment_status,' +
  'response_deadline,expires_at,request_number,case_id,created_at'

/** person id → count of still-active warrant-type requests. The DB vocabulary
 *  is request_type='warrant' with the kind in `subtype`; liveness (terminal
 *  review/fulfilment states, expiry) is personIntel's isLegalActive. */
export function activeWarrantCounts(rows: WarrantLite[], todayISO: string): Map<string, number> {
  const map = new Map<string, number>()
  for (const r of rows) {
    if (!r.person_id || r.request_type !== 'warrant') continue
    if (!isLegalActive(r, todayISO)) continue
    map.set(r.person_id, (map.get(r.person_id) ?? 0) + 1)
  }
  return map
}

export interface RegistryStats {
  /** person id → linked case count (case_intel_links, kind='person'). */
  caseCounts: Map<string, number>
  /** person id → owned + linked vehicle count. */
  vehicleCounts: Map<string, number>
  /** person id → active warrant-type legal requests. */
  warrantCounts: Map<string, number>
  /** Ids that appear in any possible-duplicate cluster. */
  duplicateIds: Set<string>
  duplicateClusters: number
}

export function buildRegistryStats(input: {
  persons: RegistryPerson[]
  intelLinks: { ref_id: string }[]
  vehicles: { id: string; owner_id: string | null }[]
  personVehicles: { person_id: string; vehicle_id: string }[]
  legal: WarrantLite[]
  todayISO: string
}): RegistryStats {
  const caseCounts = new Map<string, number>()
  for (const l of input.intelLinks) caseCounts.set(l.ref_id, (caseCounts.get(l.ref_id) ?? 0) + 1)
  const vehicleCounts = new Map<string, number>()
  const vehicleLinks: Array<{ person_id: string; vehicle_id: string }> = []
  for (const v of input.vehicles) if (v.owner_id) {
    vehicleCounts.set(v.owner_id, (vehicleCounts.get(v.owner_id) ?? 0) + 1)
    vehicleLinks.push({ person_id: v.owner_id, vehicle_id: v.id })
  }
  for (const pv of input.personVehicles) {
    vehicleCounts.set(pv.person_id, (vehicleCounts.get(pv.person_id) ?? 0) + 1)
    vehicleLinks.push(pv)
  }
  // Shared-vehicle links strengthen duplicate signals (owner + non-owner).
  const clusters = findDuplicatePersons(input.persons, { vehicles: vehicleLinks })
  const duplicateIds = new Set<string>()
  for (const c of clusters) for (const id of c.ids) duplicateIds.add(id)
  return {
    caseCounts,
    vehicleCounts,
    warrantCounts: activeWarrantCounts(input.legal, input.todayISO),
    duplicateIds,
    duplicateClusters: clusters.length,
  }
}

/* ---- Filters --------------------------------------------------------------- */

export interface RegistryFilters {
  /** Active (non-expired) BOLO only. */
  bolo: boolean
  /** ≥1 active warrant-type legal request. */
  warrant: boolean
  /** '' any · 'none' no gang · a gang id. */
  gang: string
  classification: string
  /** '' default (merged hidden unless includeMerged) · a lifecycle value. */
  lifecycle: string
  confidence: string
  stale: boolean
  duplicate: boolean
  missingMugshot: boolean
  missingDob: boolean
  /** No next_review_at scheduled. */
  noReview: boolean
  /** '' any · 'linked' · 'unlinked'. */
  cases: string
  /** '' any · 'linked' · 'unlinked'. */
  vehicles: string
  /** Updated within the last 7 days. */
  recent: boolean
  /** felony_count ≥ 8 (the registry's long-standing violent-history flag). */
  highFelony: boolean
  includeMerged: boolean
}

export const EMPTY_REGISTRY_FILTERS: RegistryFilters = {
  bolo: false, warrant: false, gang: '', classification: '', lifecycle: '', confidence: '',
  stale: false, duplicate: false, missingMugshot: false, missingDob: false, noReview: false,
  cases: '', vehicles: '', recent: false, highFelony: false, includeMerged: false,
}

const BOOL_KEYS = ['bolo', 'warrant', 'stale', 'duplicate', 'missingMugshot', 'missingDob', 'noReview', 'recent', 'highFelony', 'includeMerged'] as const
const TEXT_KEYS = ['gang', 'classification', 'lifecycle', 'confidence', 'cases', 'vehicles'] as const

export function loadRegistryFilters(): RegistryFilters {
  const f = Store.get<Partial<RegistryFilters>>('personFilters', {})
  const out: RegistryFilters = { ...EMPTY_REGISTRY_FILTERS }
  for (const k of BOOL_KEYS) if (typeof f[k] === 'boolean') out[k] = f[k]
  for (const k of TEXT_KEYS) if (typeof f[k] === 'string') out[k] = f[k]
  return out
}
export const persistRegistryFilters = (f: RegistryFilters): void => Store.set('personFilters', f)

export const activeRegistryFilterCount = (f: RegistryFilters): number =>
  BOOL_KEYS.filter((k) => f[k]).length + TEXT_KEYS.filter((k) => f[k]).length

export interface FilterChip {
  key: string
  label: string
  /** Patch that removes just this filter. */
  patch: Partial<RegistryFilters>
}

/** Every active filter as a dismissible chip descriptor. */
export function registryFilterChips(f: RegistryFilters, gangNameOf: (id: string) => string | null): FilterChip[] {
  const chips: FilterChip[] = []
  if (f.bolo) chips.push({ key: 'bolo', label: 'Active BOLO', patch: { bolo: false } })
  if (f.warrant) chips.push({ key: 'warrant', label: 'Active warrant', patch: { warrant: false } })
  if (f.stale) chips.push({ key: 'stale', label: 'Stale intel', patch: { stale: false } })
  if (f.duplicate) chips.push({ key: 'duplicate', label: 'Possible duplicate', patch: { duplicate: false } })
  if (f.gang) chips.push({ key: 'gang', label: f.gang === 'none' ? 'No gang' : `Gang: ${gangNameOf(f.gang) ?? 'Unknown'}`, patch: { gang: '' } })
  if (f.classification) chips.push({ key: 'classification', label: classificationLabel(f.classification), patch: { classification: '' } })
  if (f.lifecycle) chips.push({ key: 'lifecycle', label: `Lifecycle: ${lifecycleLabel(f.lifecycle)}`, patch: { lifecycle: '' } })
  if (f.confidence) chips.push({ key: 'confidence', label: `Confidence: ${confidenceLabel(f.confidence)}`, patch: { confidence: '' } })
  if (f.missingMugshot) chips.push({ key: 'missingMugshot', label: 'Missing mugshot', patch: { missingMugshot: false } })
  if (f.missingDob) chips.push({ key: 'missingDob', label: 'Missing DOB', patch: { missingDob: false } })
  if (f.noReview) chips.push({ key: 'noReview', label: 'No review scheduled', patch: { noReview: false } })
  if (f.cases) chips.push({ key: 'cases', label: f.cases === 'linked' ? 'Linked to cases' : 'No linked cases', patch: { cases: '' } })
  if (f.vehicles) chips.push({ key: 'vehicles', label: f.vehicles === 'linked' ? 'Has vehicles' : 'No vehicles', patch: { vehicles: '' } })
  if (f.recent) chips.push({ key: 'recent', label: 'Updated ≤7d', patch: { recent: false } })
  if (f.highFelony) chips.push({ key: 'highFelony', label: '8+ felonies', patch: { highFelony: false } })
  if (f.includeMerged) chips.push({ key: 'includeMerged', label: 'Incl. merged', patch: { includeMerged: false } })
  return chips
}

const WEEK_MS = 7 * 86_400_000

export interface FilterContext {
  now: number
  /** Local YYYY-MM-DD, for BOLO/warrant expiry comparison. */
  today: string
  stats: RegistryStats
}

export function applyRegistryFilters(rows: RegistryPerson[], f: RegistryFilters, ctx: FilterContext): RegistryPerson[] {
  const { caseCounts, vehicleCounts, warrantCounts, duplicateIds } = ctx.stats
  return rows.filter((p) => {
    // Lifecycle: an explicit lifecycle filter (incl. 'merged') always wins;
    // otherwise merged tombstones stay hidden unless opted in.
    if (f.lifecycle) { if (p.lifecycle !== f.lifecycle) return false }
    else if (!f.includeMerged && p.lifecycle === 'merged') return false
    if (f.bolo) { const b = boloState(p, ctx.today); if (!b.active || b.expired) return false }
    if (f.warrant && !(warrantCounts.get(p.id) ?? 0)) return false
    if (f.gang === 'none') { if (p.gang_id) return false }
    else if (f.gang && p.gang_id !== f.gang) return false
    if (f.classification && (p.classification ?? '') !== f.classification) return false
    if (f.confidence && (p.confidence ?? '') !== f.confidence) return false
    if (f.stale && !isStaleRecord(p, ctx.now)) return false
    if (f.duplicate && !duplicateIds.has(p.id)) return false
    if (f.missingMugshot && p.mugshot_url) return false
    if (f.missingDob && p.dob) return false
    if (f.noReview && p.next_review_at) return false
    const cases = caseCounts.get(p.id) ?? 0
    if (f.cases === 'linked' && !cases) return false
    if (f.cases === 'unlinked' && cases) return false
    const vehicles = vehicleCounts.get(p.id) ?? 0
    if (f.vehicles === 'linked' && !vehicles) return false
    if (f.vehicles === 'unlinked' && vehicles) return false
    if (f.recent && ctx.now - Date.parse(p.updated_at) > WEEK_MS) return false
    if (f.highFelony && (p.felony_count ?? 0) < 8) return false
    return true
  })
}

/* ---- Sorting ---------------------------------------------------------------- */

export const REGISTRY_SORTS = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'reviewed', label: 'Last reviewed' },
  { value: 'staleness', label: 'Most stale first' },
  { value: 'cases', label: 'Case count' },
  { value: 'felonies', label: 'Felony count' },
  { value: 'priority', label: 'Priority' },
] as const
export type RegistrySort = (typeof REGISTRY_SORTS)[number]['value']

export const loadRegistrySort = (): RegistrySort => {
  const s = Store.get<string>('personsSort', 'updated')
  return REGISTRY_SORTS.some((x) => x.value === s) ? (s as RegistrySort) : 'updated'
}

const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
const ts = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isNaN(t) ? 0 : t
}

export function sortRegistry(rows: RegistryPerson[], sort: RegistrySort, stats: RegistryStats): RegistryPerson[] {
  const by = (cmp: (a: RegistryPerson, b: RegistryPerson) => number) =>
    rows.slice().sort((a, b) => cmp(a, b) || a.name.localeCompare(b.name))
  switch (sort) {
    case 'name': return rows.slice().sort((a, b) => a.name.localeCompare(b.name))
    case 'reviewed': return by((a, b) => ts(b.reviewed_at) - ts(a.reviewed_at))
    case 'staleness': return by((a, b) => ts(a.reviewed_at) - ts(b.reviewed_at)) // never-reviewed (0) first
    case 'cases': return by((a, b) => (stats.caseCounts.get(b.id) ?? 0) - (stats.caseCounts.get(a.id) ?? 0))
    case 'felonies': return by((a, b) => (b.felony_count ?? 0) - (a.felony_count ?? 0))
    case 'priority': return by((a, b) =>
      (PRIORITY_RANK[a.priority ?? ''] ?? 9) - (PRIORITY_RANK[b.priority ?? ''] ?? 9))
    case 'updated':
    default: return by((a, b) => ts(b.updated_at) - ts(a.updated_at))
  }
}
