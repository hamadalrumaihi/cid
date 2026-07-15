/** Pure intelligence helpers for the Gangs dossier — rank tiering, duplicate
 *  detection, staleness, controlled vocabularies, and colour-swatch parsing.
 *  Kept side-effect-free and framework-free so they're unit-testable and shared
 *  by the dossier, the roster table, and the registry. */

import type { GangRow, MemberRow, TurfRow } from './gangShared'

// ── Controlled vocabularies (mirror the CHECK constraints in
//    20260724010000_gang_intelligence.sql) ───────────────────────────────────
export const GANG_STATUSES = ['active', 'emerging', 'dormant', 'disbanded', 'historical', 'unknown'] as const
export const GANG_CLASSIFICATIONS = ['street_gang', 'organized_crime', 'motorcycle_club', 'faction', 'cartel', 'crew', 'unknown'] as const
export const CONFIDENCE_LEVELS = ['confirmed', 'probable', 'possible', 'unverified', 'disproven'] as const
export const PROVENANCE_KINDS = ['imported', 'reported', 'manually_confirmed', 'inferred', 'historical', 'disputed'] as const
export const TURF_STATUSES = ['claimed', 'confirmed', 'contested', 'historical', 'unknown'] as const

export const humanize = (s?: string | null) =>
  s ? s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : ''

// ── Rank tiers ──────────────────────────────────────────────────────────────
// gang_ranks is an orphaned scaffold and member.rank is free text, so we map
// the free-text rank into a controlled hierarchy by keyword. Unknown ranks are
// never dropped — they fall into the "Unknown" tier but keep their original
// label on the row.
export type TierId = 'leader' | 'command' | 'senior' | 'member' | 'associate' | 'unknown'

export interface Tier { id: TierId; label: string; order: number }

export const RANK_TIERS: Tier[] = [
  { id: 'leader', label: 'Leadership', order: 0 },
  { id: 'command', label: 'Command', order: 1 },
  { id: 'senior', label: 'Senior', order: 2 },
  { id: 'member', label: 'Members', order: 3 },
  { id: 'associate', label: 'Associates & Prospects', order: 4 },
  { id: 'unknown', label: 'Unranked / Unknown', order: 5 },
]

const TIER_MATCHERS: Array<{ id: TierId; kw: RegExp }> = [
  { id: 'command', kw: /\b(co[-\s]?leader|under[-\s]?boss|second|deputy|lieutenant|\blt\b|captain|command|consig)/i },
  { id: 'leader', kw: /\b(leader|shot[-\s]?caller|\bog\b|boss|kingpin|head|chief|founder|don|hna)\b/i },
  { id: 'senior', kw: /\b(senior|enforcer|veteran|vet|sergeant|sgt|elder|core)\b/i },
  { id: 'associate', kw: /\b(associate|prospect|affiliate|hang[-\s]?around|recruit|runner|prospekt)\b/i },
  { id: 'member', kw: /\b(soldier|member|foot|street|shooter|full[-\s]?patch|patched)\b/i },
]

/** Map a free-text rank to a tier. Command is checked before leader so
 *  "co-leader"/"lieutenant" don't get swept into Leadership. */
export function rankTier(rank?: string | null): TierId {
  const r = (rank ?? '').trim()
  if (!r) return 'unknown'
  for (const m of TIER_MATCHERS) if (m.kw.test(r)) return m.id
  return 'unknown'
}

export const tierMeta = (id: TierId): Tier => RANK_TIERS.find((t) => t.id === id) ?? RANK_TIERS[5]

/** Group members into ordered tiers; empty tiers are omitted. Within a tier,
 *  members keep insertion order. */
export function groupByTier(members: MemberRow[]): Array<{ tier: Tier; members: MemberRow[] }> {
  const buckets = new Map<TierId, MemberRow[]>()
  for (const m of members) {
    const id = rankTier(m.rank)
    buckets.set(id, [...(buckets.get(id) ?? []), m])
  }
  return RANK_TIERS
    .map((tier) => ({ tier, members: buckets.get(tier.id) ?? [] }))
    .filter((g) => g.members.length > 0)
}

// ── Duplicate detection (non-destructive) ─────────────────────────────────────
export const normalizeName = (name?: string | null) =>
  (name ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim()

export interface DuplicateCluster {
  key: string
  members: MemberRow[]
  reason: string
}

/** Flag likely-duplicate members within a gang. Exact normalized-name matches
 *  are grouped; a shared linked person_id strengthens the signal. Never
 *  mutates or removes anything — this only surfaces clusters for review. */
export function findDuplicateMembers(members: MemberRow[]): DuplicateCluster[] {
  const byName = new Map<string, MemberRow[]>()
  for (const m of members) {
    const k = normalizeName(m.name)
    if (!k) continue
    byName.set(k, [...(byName.get(k) ?? []), m])
  }
  const clusters: DuplicateCluster[] = []
  for (const [key, group] of byName) {
    if (group.length < 2) continue
    const personIds = new Set(group.map((m) => m.person_id).filter(Boolean))
    const reason =
      personIds.size === 1 && personIds.has(group[0].person_id)
        ? 'Same name and same linked person'
        : 'Same name within this gang'
    clusters.push({ key, members: group, reason })
  }
  // Most-collisions first.
  return clusters.sort((a, b) => b.members.length - a.members.length)
}

/** The set of member ids that participate in any duplicate cluster — for a
 *  per-row “possible duplicate” marker. */
export function duplicateMemberIds(members: MemberRow[]): Set<string> {
  const ids = new Set<string>()
  for (const c of findDuplicateMembers(members)) for (const m of c.members) ids.add(m.id)
  return ids
}

// ── Duplicate merge planning (pure — execution lives in MergeMembersModal) ───
/** Fields the merge flow compares and can carry from a duplicate onto the
 *  survivor. name/gang_id are the cluster identity; created_at/updated_at are
 *  row bookkeeping — none of those are merge candidates. */
export const MERGE_FIELDS = [
  'rank', 'callsign', 'status', 'person_id', 'ccw', 'vch', 'felony_count', 'mugshot_url', 'provenance',
] as const
export type MergeField = (typeof MERGE_FIELDS)[number]
export type MergeValue = MemberRow[MergeField]
export type MergePatch = Partial<Pick<MemberRow, MergeField>>

/** "Empty" for merge purposes: null/blank, plus the schema defaults (false, 0)
 *  — so a duplicate's CCW=yes or a real felony count is treated as richer than
 *  the survivor's default. */
const isEmptyMergeValue = (v: MergeValue | undefined): boolean =>
  v === null || v === undefined || v === false || v === 0 || (typeof v === 'string' && !v.trim())

export interface MergePlan {
  /** Field values to write onto the survivor — only fields that actually
   *  change; an empty patch means no survivor update is needed. */
  patch: MergePatch
  /** The rows to delete. The survivor is never in this list, even if the
   *  caller passed it inside `duplicates`. */
  deletions: MemberRow[]
}

/** Plan a non-destructive-by-review merge: keep the survivor's value for every
 *  field, except where the survivor's value is empty and a duplicate has one —
 *  then the first non-empty duplicate value is adopted (this covers person_id
 *  adoption). Explicit `choices` (from the review UI) override both. Pure:
 *  plans only, never mutates or writes. */
export function planMerge(
  survivor: MemberRow,
  duplicates: MemberRow[],
  choices: Partial<Record<MergeField, MergeValue>> = {},
): MergePlan {
  const deletions = duplicates.filter((d) => d.id !== survivor.id)
  const patch: Record<string, MergeValue> = {}
  for (const f of MERGE_FIELDS) {
    const chosen = Object.prototype.hasOwnProperty.call(choices, f)
      ? choices[f] ?? null
      : isEmptyMergeValue(survivor[f])
        ? deletions.map((d) => d[f]).find((v) => !isEmptyMergeValue(v)) ?? survivor[f]
        : survivor[f]
    if (!Object.is(chosen ?? null, survivor[f] ?? null)) patch[f] = chosen ?? null
  }
  return { patch: patch as MergePatch, deletions }
}

// ── Staleness / review ───────────────────────────────────────────────────────
export const DEFAULT_REVIEW_DAYS = 90

export function daysSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : Math.floor((now - t) / 86_400_000)
}

/** True when the gang's intel is overdue for review: never reviewed, or last
 *  reviewed more than `thresholdDays` ago, or a next_review_at in the past. */
export function isGangStale(gang: GangRow, now: number, thresholdDays = DEFAULT_REVIEW_DAYS): boolean {
  const next = gang.next_review_at ? Date.parse(gang.next_review_at) : NaN
  if (!Number.isNaN(next) && next < now) return true
  const d = daysSince(gang.reviewed_at, now)
  return d === null || d >= thresholdDays
}

// ── Intelligence summary sections (order + labels) ───────────────────────────
export const SUMMARY_SECTIONS: Array<{ key: string; label: string }> = [
  { key: 'executive', label: 'Executive summary' },
  { key: 'identifiers', label: 'Known identifiers & colors' },
  { key: 'leadership', label: 'Leadership' },
  { key: 'territory', label: 'Territory' },
  { key: 'activity', label: 'Criminal activity / MO' },
  { key: 'weapons', label: 'Weapons & capabilities' },
  { key: 'vehicles', label: 'Vehicles' },
  { key: 'associates', label: 'Known associates' },
  { key: 'encounters', label: 'Recent encounters' },
  { key: 'gaps', label: 'Intelligence gaps' },
  { key: 'sources', label: 'Source notes' },
]

// ── Colour swatches ──────────────────────────────────────────────────────────
const NAMED_COLORS: Record<string, string> = {
  black: '#111827', white: '#f8fafc', grey: '#9ca3af', gray: '#9ca3af', silver: '#cbd5e1',
  red: '#ef4444', crimson: '#dc2626', maroon: '#7f1d1d', orange: '#f97316', amber: '#f59e0b',
  yellow: '#eab308', gold: '#d4af37', green: '#22c55e', lime: '#84cc16', teal: '#14b8a6',
  blue: '#3b82f6', navy: '#1e3a8a', royal: '#2563eb', cyan: '#06b6d4', purple: '#a855f7',
  violet: '#8b5cf6', pink: '#ec4899', magenta: '#d946ef', brown: '#92400e', tan: '#d2b48c',
}

export interface Swatch { name: string; css: string | null }

/** Parse a free-text colors field ("Black and Gold", "red/blue") into swatches.
 *  Unknown tokens keep their label with no chip (`css: null`) rather than being
 *  guessed at. */
export function parseColors(colors?: string | null): Swatch[] {
  if (!colors) return []
  return colors
    .split(/[,/&]|\band\b|\+/i)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((token) => {
      const key = token.toLowerCase().replace(/[^a-z]/g, '')
      return { name: token, css: NAMED_COLORS[key] ?? null }
    })
}

// ── Turf staleness (uses last_confirmed || updated_at || created_at) ─────────
export function turfLastKnown(t: TurfRow): string | null {
  return t.last_confirmed ?? t.updated_at ?? t.created_at ?? null
}
