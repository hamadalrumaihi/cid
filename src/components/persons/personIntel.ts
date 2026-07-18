/** Pure intelligence helpers for the Persons workspace — controlled
 *  vocabularies, review staleness, BOLO display state, legal-status mapping,
 *  duplicate detection, merge preview, and data-quality warnings.
 *  Kept side-effect-free and framework-free (no React, no db, no Date.now())
 *  so they're unit-testable and shared by the registry, the profile, and the
 *  BOLO board. gangIntel.ts is the template. */

import type { Tables } from '@/lib/database.types'
import { parsePersonIdentity } from '@/lib/jsonShapes'

// Typed read boundaries for the persons jsonb columns. `identity` has its own
// parser; `intelligence_summary` stores the same section → text record shape
// as gangs, so parseIntelSummary is reused as-is (documented in jsonShapes).
export { parseIntelSummary, parsePersonIdentity } from '@/lib/jsonShapes'
export type { PersonIdentity } from '@/lib/jsonShapes'

/** Every persons column this module reads — the minimal projection callers
 *  must fetch. A full Tables<'persons'> row satisfies it. */
export type PersonRowLike = Pick<
  Tables<'persons'>,
  | 'id' | 'name' | 'alias' | 'dob' | 'phone' | 'mugshot_url' | 'gang_id'
  | 'classification' | 'confidence' | 'priority' | 'status'
  | 'lifecycle' | 'merged_into' | 'identity'
  | 'bolo' | 'bolo_reason' | 'bolo_risk' | 'bolo_expires_at'
  | 'reviewed_at' | 'next_review_at'
>

// ── Controlled vocabularies (mirror the CHECK constraints in
//    20260729010000_person_intelligence.sql) ─────────────────────────────────
export const PERSON_CLASSIFICATIONS = ['person_of_interest', 'suspect', 'witness', 'victim', 'informant', 'associate', 'other'] as const
export const PERSON_LIFECYCLES = ['active', 'inactive', 'historical', 'cleared', 'archived', 'merged'] as const
/** Also the bolo_risk vocabulary — the two CHECKs share it. */
export const PERSON_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const
export const RELATIONSHIP_TYPES = ['associate', 'family', 'partner', 'co_suspect', 'gang_associate', 'business', 'known_contact', 'witness', 'victim', 'informant', 'unknown'] as const
export const PLACE_ROLES = ['residence', 'workplace', 'hangout', 'stash', 'meeting', 'business', 'family_property', 'historical_address', 'observed_at', 'other'] as const
export const VEHICLE_ROLES = ['driver', 'passenger', 'seen_using', 'associated', 'gang_vehicle', 'historical', 'other'] as const
export const LINK_STATUSES = ['current', 'historical', 'disputed'] as const
/** Shared by persons.confidence and every link table's confidence column. */
export const CONFIDENCE_LEVELS = ['confirmed', 'probable', 'possible', 'unverified', 'disproven'] as const

const humanize = (s?: string | null) =>
  s ? s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : ''

const labelMap = <T extends readonly string[]>(vals: T): Record<T[number], string> =>
  Object.fromEntries(vals.map((v) => [v, humanize(v)])) as Record<T[number], string>

export const CLASSIFICATION_LABELS = labelMap(PERSON_CLASSIFICATIONS)
export const LIFECYCLE_LABELS = labelMap(PERSON_LIFECYCLES)
export const PRIORITY_LABELS = labelMap(PERSON_PRIORITIES)
export const RELATIONSHIP_LABELS = labelMap(RELATIONSHIP_TYPES)
export const PLACE_ROLE_LABELS = labelMap(PLACE_ROLES)
export const VEHICLE_ROLE_LABELS = labelMap(VEHICLE_ROLES)
export const LINK_STATUS_LABELS = labelMap(LINK_STATUSES)
export const CONFIDENCE_LABELS = labelMap(CONFIDENCE_LEVELS)

// Label helpers: known values hit the maps; unknown (legacy free-text) values
// are humanized rather than dropped; null/blank → ''.
export const classificationLabel = (v?: string | null) => (v && CLASSIFICATION_LABELS[v as (typeof PERSON_CLASSIFICATIONS)[number]]) || humanize(v)
export const lifecycleLabel = (v?: string | null) => (v && LIFECYCLE_LABELS[v as (typeof PERSON_LIFECYCLES)[number]]) || humanize(v)
export const priorityLabel = (v?: string | null) => (v && PRIORITY_LABELS[v as (typeof PERSON_PRIORITIES)[number]]) || humanize(v)
export const relationshipLabel = (v?: string | null) => (v && RELATIONSHIP_LABELS[v as (typeof RELATIONSHIP_TYPES)[number]]) || humanize(v)
export const placeRoleLabel = (v?: string | null) => (v && PLACE_ROLE_LABELS[v as (typeof PLACE_ROLES)[number]]) || humanize(v)
export const vehicleRoleLabel = (v?: string | null) => (v && VEHICLE_ROLE_LABELS[v as (typeof VEHICLE_ROLES)[number]]) || humanize(v)
export const linkStatusLabel = (v?: string | null) => (v && LINK_STATUS_LABELS[v as (typeof LINK_STATUSES)[number]]) || humanize(v)
export const confidenceLabel = (v?: string | null) => (v && CONFIDENCE_LABELS[v as (typeof CONFIDENCE_LEVELS)[number]]) || humanize(v)

// ── Staleness / review (gang precedent: DEFAULT_REVIEW_DAYS = 90) ────────────
export const PERSON_REVIEW_DAYS = 90

export function daysSince(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  // Clamped at 0: a timestamp stamped moments after the caller's `now`
  // snapshot (e.g. Mark reviewed on an already-open profile) must read as
  // "0 days since", never -1.
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((nowMs - t) / 86_400_000))
}

/** True when the person's intel is overdue for review: never reviewed, or last
 *  reviewed `thresholdDays`+ days ago. */
export function isPersonStale(reviewedAt: string | null | undefined, nowMs: number, thresholdDays = PERSON_REVIEW_DAYS): boolean {
  const d = daysSince(reviewedAt, nowMs)
  return d === null || d >= thresholdDays
}

/** Review state for badges: 'unreviewed' (no review on record), 'due' (an
 *  explicit next_review_at has passed), 'stale' (last review ≥ threshold days
 *  ago), else 'fresh'. */
export function reviewDueState(
  p: { reviewed_at: string | null; next_review_at: string | null },
  nowMs: number,
): 'unreviewed' | 'due' | 'stale' | 'fresh' {
  if (!p.reviewed_at) return 'unreviewed'
  const next = p.next_review_at ? Date.parse(p.next_review_at) : NaN
  if (!Number.isNaN(next) && next < nowMs) return 'due'
  return isPersonStale(p.reviewed_at, nowMs) ? 'stale' : 'fresh'
}

// ── Structured intelligence summary (order + labels; same mechanism as
//    gangs — values live in persons.intelligence_summary via parseIntelSummary)
export const PERSON_SUMMARY_SECTIONS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'executive_summary', label: 'Executive summary' },
  { key: 'current_relevance', label: 'Current relevance' },
  { key: 'known_activities', label: 'Known activities' },
  { key: 'modus_operandi', label: 'Modus operandi' },
  { key: 'affiliations', label: 'Affiliations' },
  { key: 'risk_considerations', label: 'Risk considerations' },
  { key: 'recent_encounters', label: 'Recent encounters' },
  { key: 'intelligence_gaps', label: 'Intelligence gaps' },
  { key: 'source_notes', label: 'Source notes' },
]

// ── BOLO display rules ────────────────────────────────────────────────────────
export interface BoloState {
  active: boolean
  /** bolo is still true but bolo_expires_at has passed — the BOLO keeps
   *  showing, flagged for review, until someone clears it. */
  expired: boolean
  risk: string | null
  reason: string | null
  expiresAt: string | null
}

/** Date-only comparison — bolo_expires_at is a `date` column. */
const dateOnly = (iso?: string | null) => (iso ?? '').slice(0, 10)

export function boloState(
  p: Pick<PersonRowLike, 'bolo' | 'bolo_reason' | 'bolo_risk' | 'bolo_expires_at'>,
  todayISO: string,
): BoloState {
  if (!p.bolo) return { active: false, expired: false, risk: null, reason: null, expiresAt: null }
  const expiresAt = p.bolo_expires_at ?? null
  const expired = !!expiresAt && dateOnly(expiresAt) < dateOnly(todayISO)
  return { active: true, expired, risk: p.bolo_risk ?? null, reason: p.bolo_reason?.trim() || null, expiresAt }
}

// ── Legal status mapping ─────────────────────────────────────────────────────
/** The legal_requests projection this module reads — a bare workflow slice,
 *  never narrative/form_data. `subtype` is required because the DB vocabulary
 *  is request_type ∈ {warrant, subpoena} with the specific kind
 *  (arrest_warrant / search_warrant / surveillance_cctv / …) in `subtype`. */
export type LegalLite = Pick<
  Tables<'legal_requests'>,
  | 'id' | 'request_type' | 'subtype' | 'review_status' | 'fulfilment_status'
  | 'response_deadline' | 'expires_at' | 'request_number' | 'case_id' | 'created_at'
>

export interface PersonLegalSummary {
  arrestWarrants: LegalLite[]
  searchWarrants: LegalLite[]
  subpoenas: LegalLite[]
  surveillance: LegalLite[]
  other: LegalLite[]
  activeCount: number
}

/** Terminal review states — the request will never issue. */
const TERMINAL_REVIEW = new Set(['denied', 'withdrawn', 'closed'])
/** Done fulfilment states — the instrument's work is finished or void. */
const DONE_FULFILMENT = new Set(['closed', 'returned', 'return_recorded', 'revoked', 'expired'])

/** Active = not in a terminal review state, not in a done fulfilment state,
 *  and not past its expires_at (covers rows whose fulfilment_status was never
 *  flipped to 'expired'). */
export function isLegalActive(r: LegalLite, todayISO: string): boolean {
  if (TERMINAL_REVIEW.has(r.review_status)) return false
  if (DONE_FULFILMENT.has(r.fulfilment_status)) return false
  if (r.expires_at && dateOnly(r.expires_at) < dateOnly(todayISO)) return false
  return true
}

/** Classify a person's legal_requests rows for the profile's legal panel.
 *  Buckets keep input order and include inactive rows (history matters);
 *  activeCount counts the still-live instruments across all buckets. */
export function legalStatusOf(rows: LegalLite[], todayISO: string): PersonLegalSummary {
  const out: PersonLegalSummary = { arrestWarrants: [], searchWarrants: [], subpoenas: [], surveillance: [], other: [], activeCount: 0 }
  for (const r of rows) {
    if (r.request_type === 'warrant' && r.subtype === 'arrest_warrant') out.arrestWarrants.push(r)
    else if (r.request_type === 'warrant' && r.subtype === 'search_warrant') out.searchWarrants.push(r)
    else if (r.request_type === 'subpoena' && r.subtype === 'surveillance_cctv') out.surveillance.push(r)
    else if (r.request_type === 'subpoena') out.subpoenas.push(r)
    else out.other.push(r)
    if (isLegalActive(r, todayISO)) out.activeCount += 1
  }
  return out
}

// ── Duplicate detection (non-destructive) ────────────────────────────────────
/** Mirrors gangIntel's normalizeName — lowercase, strip punctuation/diacritic
 *  marks, collapse whitespace. */
export const normalizeName = (name?: string | null) =>
  (name ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim()

export interface DuplicateSignal {
  kind: 'name' | 'alias' | 'dob' | 'phone' | 'mugshot' | 'vehicle' | 'place' | 'name_gang'
  detail: string
}

export interface DuplicateCluster {
  ids: string[]
  confidence: 'strong' | 'possible'
  signals: DuplicateSignal[]
}

const phoneDigits = (s?: string | null) => (s ?? '').replace(/\D+/g, '')

/** "Similar" names for the same-gang signal: equal, containment, or a shared
 *  surname (last token, 3+ chars). */
const similarNames = (na: string, nb: string): boolean => {
  if (!na || !nb) return false
  if (na === nb || na.includes(nb) || nb.includes(na)) return true
  const la = na.split(' ').at(-1) ?? ''
  return la.length >= 3 && la === (nb.split(' ').at(-1) ?? '')
}

interface DupKey {
  row: PersonRowLike
  name: string
  aliases: string[]
  dob: string
  phone: string
  mug: string
  vehicles: Set<string>
  places: Set<string>
}

/** Flag likely-duplicate person records. Strong signals: same normalized name
 *  + same dob, same phone, same mugshot_url, or one record's alias matching
 *  the other's name. Possible signals: same normalized name alone, a similar
 *  name inside the same gang, or a shared vehicle/place link. Rows with
 *  lifecycle 'merged' are excluded; a person is never paired with itself;
 *  output ordering is stable (strong clusters first, then by first appearance
 *  in the input). Never mutates or removes anything — this only surfaces
 *  clusters for human review; the person_merge RPC does the real work. */
export function findDuplicatePersons(
  persons: PersonRowLike[],
  links?: {
    vehicles?: Array<{ person_id: string; vehicle_id: string }>
    places?: Array<{ person_id: string; place_id: string }>
  },
): DuplicateCluster[] {
  const rows = persons.filter((p) => p.lifecycle !== 'merged')
  const vehiclesBy = new Map<string, Set<string>>()
  for (const l of links?.vehicles ?? []) vehiclesBy.set(l.person_id, (vehiclesBy.get(l.person_id) ?? new Set()).add(l.vehicle_id))
  const placesBy = new Map<string, Set<string>>()
  for (const l of links?.places ?? []) placesBy.set(l.person_id, (placesBy.get(l.person_id) ?? new Set()).add(l.place_id))

  const keys: DupKey[] = rows.map((p) => {
    const idn = parsePersonIdentity(p.identity)
    return {
      row: p,
      name: normalizeName(p.name),
      aliases: [p.alias ?? '', ...idn.aliases, ...idn.street_names].map(normalizeName).filter(Boolean),
      dob: dateOnly(p.dob),
      phone: phoneDigits(p.phone),
      mug: p.mugshot_url?.trim() ?? '',
      vehicles: vehiclesBy.get(p.id) ?? new Set(),
      places: placesBy.get(p.id) ?? new Set(),
    }
  })

  const pairSignals = (a: DupKey, b: DupKey): { signals: DuplicateSignal[]; strong: boolean } => {
    const signals: DuplicateSignal[] = []
    let strong = false
    const push = (s: DuplicateSignal, isStrong: boolean) => { signals.push(s); strong = strong || isStrong }
    const sameName = !!a.name && a.name === b.name
    const dobMatch = sameName && !!a.dob && a.dob === b.dob
    if (dobMatch) push({ kind: 'dob', detail: 'Same name and date of birth' }, true)
    if (a.phone.length >= 4 && a.phone === b.phone) push({ kind: 'phone', detail: 'Same phone number' }, true)
    if (a.mug && a.mug === b.mug) push({ kind: 'mugshot', detail: 'Same mugshot' }, true)
    if ((!!b.name && a.aliases.includes(b.name)) || (!!a.name && b.aliases.includes(a.name)))
      push({ kind: 'alias', detail: "Alias matches the other record's name" }, true)
    if (sameName && !dobMatch) push({ kind: 'name', detail: 'Same name' }, false)
    if (!sameName && !!a.row.gang_id && a.row.gang_id === b.row.gang_id && similarNames(a.name, b.name))
      push({ kind: 'name_gang', detail: 'Similar name in the same gang' }, false)
    if ([...a.vehicles].some((v) => b.vehicles.has(v))) push({ kind: 'vehicle', detail: 'Linked to the same vehicle' }, false)
    if ([...a.places].some((v) => b.places.has(v))) push({ kind: 'place', detail: 'Linked to the same place' }, false)
    return { signals, strong }
  }

  // Union-find over matched pairs, accumulating each pair's signals.
  const parent = new Map<string, string>()
  const find = (id: string): string => {
    const p = parent.get(id) ?? id
    if (p === id) return id
    const root = find(p)
    parent.set(id, root)
    return root
  }
  const union = (a: string, b: string) => { parent.set(find(a), find(b)) }
  const pairs: Array<{ a: string; b: string; signals: DuplicateSignal[]; strong: boolean }> = []
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const { signals, strong } = pairSignals(keys[i], keys[j])
      if (signals.length === 0) continue
      union(keys[i].row.id, keys[j].row.id)
      pairs.push({ a: keys[i].row.id, b: keys[j].row.id, signals, strong })
    }
  }

  const orderOf = new Map(keys.map((k, i) => [k.row.id, i]))
  const clusters = new Map<string, DuplicateCluster & { order: number }>()
  const clusterOf = (id: string) => {
    const root = find(id)
    let c = clusters.get(root)
    if (!c) { c = { ids: [], confidence: 'possible', signals: [], order: Number.MAX_SAFE_INTEGER }; clusters.set(root, c) }
    return c
  }
  for (const { a, b, signals, strong } of pairs) {
    const c = clusterOf(a)
    for (const id of [a, b]) if (!c.ids.includes(id)) c.ids.push(id)
    if (strong) c.confidence = 'strong'
    for (const s of signals) {
      if (!c.signals.some((x) => x.kind === s.kind && x.detail === s.detail)) c.signals.push(s)
    }
  }
  const out = [...clusters.values()]
  for (const c of out) {
    c.ids.sort((x, y) => (orderOf.get(x) ?? 0) - (orderOf.get(y) ?? 0))
    c.order = orderOf.get(c.ids[0]) ?? 0
  }
  return out
    .sort((x, y) => (x.confidence === y.confidence ? x.order - y.order : x.confidence === 'strong' ? -1 : 1))
    .map(({ ids, confidence, signals }) => ({ ids, confidence, signals }))
}

/** The set of person ids that participate in any duplicate cluster — for a
 *  per-row "possible duplicate" marker. */
export function duplicatePersonIds(
  persons: PersonRowLike[],
  links?: Parameters<typeof findDuplicatePersons>[1],
): Set<string> {
  const ids = new Set<string>()
  for (const c of findDuplicatePersons(persons, links)) for (const id of c.ids) ids.add(id)
  return ids
}

// ── Merge preview (pure — the SERVER person_merge RPC does the real work) ────
/** Scalar fields the merge preview compares. The RPC keeps the survivor's
 *  values (only alias-when-empty, notes, and the BOLO block fold), so any
 *  differing victim value here is surfaced as a conflict for review. */
export const MERGE_COMPARE_FIELDS = [
  'name', 'alias', 'dob', 'phone', 'classification', 'status', 'priority', 'gang_id', 'mugshot_url',
] as const

/** The child/link tables person_merge repoints, in the RPC's order. */
export const MERGE_REPOINT_TABLES = [
  'gang_members', 'media', 'legal_requests', 'mdt_wanted_projections', 'vehicles',
  'case_intel_links', 'person_places', 'person_vehicles', 'person_relationships', 'narcotic_persons', 'watchlist',
] as const

export interface PersonMergePlan {
  survivor: string
  victims: string[]
  fieldConflicts: Array<{
    field: string
    survivorValue: string
    victimValues: Array<{ id: string; value: string }>
  }>
  willRepoint: Array<{ table: string; count: number }>
}

/** Build the client-side merge preview: which scalar values differ (and would
 *  be kept on the survivor / lost from the victims), and how many child rows
 *  per table the RPC will repoint. `counts[victimId][table]` is the caller's
 *  per-victim child-row count. The survivor is never a victim, even if passed
 *  among them. Pure: plans only, never mutates or writes. */
export function planPersonMerge(
  survivor: PersonRowLike,
  victims: PersonRowLike[],
  counts: Record<string, Record<string, number>>,
): PersonMergePlan {
  const vs = victims.filter((v) => v.id !== survivor.id)
  const val = (p: PersonRowLike, f: (typeof MERGE_COMPARE_FIELDS)[number]) => String(p[f] ?? '').trim()
  const fieldConflicts: PersonMergePlan['fieldConflicts'] = []
  for (const field of MERGE_COMPARE_FIELDS) {
    const survivorValue = val(survivor, field)
    const victimValues = vs
      .map((v) => ({ id: v.id, value: val(v, field) }))
      .filter((x) => x.value && x.value !== survivorValue)
    if (victimValues.length > 0) fieldConflicts.push({ field, survivorValue, victimValues })
  }
  const willRepoint: PersonMergePlan['willRepoint'] = []
  for (const table of MERGE_REPOINT_TABLES) {
    const count = vs.reduce((sum, v) => sum + (counts[v.id]?.[table] ?? 0), 0)
    if (count > 0) willRepoint.push({ table, count })
  }
  return { survivor: survivor.id, victims: vs.map((v) => v.id), fieldConflicts, willRepoint }
}

// ── Data-quality warnings (actionable, factual) ──────────────────────────────
export interface QualityWarning {
  key: string
  label: string
  severity: 'warn' | 'info'
}

/** Factual data-quality flags for the profile header. Merged tombstones carry
 *  only the broken-pointer warning — a tombstone is not expected to be
 *  reviewed, photographed, or BOLO'd. */
export function personQualityWarnings(
  p: PersonRowLike,
  ctx: { todayISO: string; nowMs: number; duplicateOf?: boolean; legacyPropertyCount: number; linkedPlaceCount: number },
): QualityWarning[] {
  const out: QualityWarning[] = []
  const add = (key: string, label: string, severity: 'warn' | 'info') => out.push({ key, label, severity })

  if (p.lifecycle === 'merged') {
    if (!p.merged_into) add('merged_without_pointer', 'Marked merged but has no surviving record pointer', 'warn')
    return out
  }
  if (!p.name?.trim()) add('missing_name', 'Name is missing', 'warn')
  if (ctx.duplicateOf) add('possible_duplicate', 'Possible duplicate of another record', 'warn')
  const review = reviewDueState(p, ctx.nowMs)
  if (review === 'unreviewed') add('never_reviewed', 'No intelligence review on record', 'warn')
  else if (review === 'due') add('review_due', 'Scheduled review date has passed', 'warn')
  else if (review === 'stale') add('stale_review', `Last reviewed ${PERSON_REVIEW_DAYS}+ days ago`, 'warn')
  if (p.bolo && !p.bolo_reason?.trim()) add('bolo_without_reason', 'Active BOLO has no reason recorded', 'warn')
  if (!p.dob) add('missing_dob', 'Date of birth is missing', 'info')
  else if (dateOnly(p.dob) > dateOnly(ctx.todayISO)) add('dob_in_future', 'Date of birth is in the future', 'warn')
  if (!p.mugshot_url?.trim()) add('missing_mugshot', 'No mugshot on file', 'info')
  const nName = normalizeName(p.name)
  if (nName && normalizeName(p.alias) === nName) add('alias_equals_name', 'Alias duplicates the name', 'info')
  if (ctx.legacyPropertyCount > 0 && ctx.linkedPlaceCount === 0)
    add('legacy_properties_unlinked', 'Legacy properties are not yet linked to Places', 'info')
  return out
}
