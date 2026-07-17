/** Pure model for the Narcotics STREET-VALUE SALES workspace (restricted).
 *
 *  Investigator-conducted controlled sales, grouped into an ongoing series, are
 *  imported and displayed with DERIVED market metrics. This module owns every
 *  calculation so the arithmetic lives in one testable place and is never
 *  hand-rolled in a component:
 *
 *   - unit conversion (original recorded unit preserved; grams derived)
 *   - per-observation metrics ($/unit, $/g, $/kg, $/lb) — rounded for display
 *     only, never written back as raw facts
 *   - stack ↔ observation total reconciliation (warn, don't overwrite)
 *   - series statistics (count / totals / min / max / median / per-tier)
 *   - the sample-size confidence indicator (Preliminary → Established)
 *   - the screenshot evidence-role vocabulary
 *   - display formatting + light validation
 *
 *  Intentionally PURE — no React, no db, no I/O. Authority is always server-side
 *  (RLS + the definer RPCs); nothing here decides access. */

import type { Tables } from '@/lib/database.types'

export type SaleObservationRow = Tables<'narcotic_sale_observations'>
export type SaleStackRow = Tables<'narcotic_sale_stacks'>

/* ── Unit conversion ──────────────────────────────────────────────────────── */
export const LB_TO_G = 453.59237
export const OZ_TO_G = 28.349523125
export const KG_TO_G = 1000

/** Convert a recorded (value, unit) to grams. Returns null when the value is
 *  missing or the unit isn't one we can safely convert — callers then suppress
 *  weight-normalized metrics rather than inventing a number. */
export function toGrams(value: number | null | undefined, unit: string | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null
  switch ((unit ?? '').toLowerCase().trim()) {
    case 'g': case 'gram': case 'grams': return value
    case 'kg': case 'kilogram': case 'kilograms': return value * KG_TO_G
    case 'lb': case 'lbs': case 'pound': case 'pounds': return value * LB_TO_G
    case 'oz': case 'ounce': case 'ounces': return value * OZ_TO_G
    case 'mg': return value / 1000
    default: return null
  }
}

/** Grams → pounds (for the $/lb metric when the original unit was pounds). */
export function gramsToPounds(g: number | null): number | null {
  return g == null ? null : g / LB_TO_G
}

/* ── Rounding / formatting ────────────────────────────────────────────────── */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** Round to `dp` decimals (used to keep 3-decimal pound weights intact while
 *  clearing floating-point summation noise). */
export function roundTo(n: number, dp: number): number {
  const f = 10 ** dp
  return Math.round((n + Number.EPSILON) * f) / f
}

/** Money for a display context. Whole-dollar amounts (the preserved integer
 *  proceeds) render without cents; derived per-metrics keep two places. */
export function formatMoney(n: number | null | undefined, opts: { cents?: boolean } = {}): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const cents = opts.cents ?? true
  return '$' + n.toLocaleString('en-US', {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  })
}

/** Whole-dollar proceeds (preserve the original integer, group with commas). */
export function formatProceeds(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const whole = Number.isInteger(n)
  return '$' + n.toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })
}

export function formatInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US')
}

/** Original recorded weight, verbatim where available; falls back to
 *  value + unit. Never silently converts. */
export function formatRecordedWeight(
  text: string | null | undefined,
  value: number | null | undefined,
  unit: string | null | undefined,
): string {
  const t = (text ?? '').trim()
  if (t) return t
  if (value == null) return '—'
  return `${value} ${(unit ?? '').trim()}`.trim()
}

/* ── Per-observation derived metrics ──────────────────────────────────────── */
export interface SaleMetrics {
  totalUnits: number
  paymentAmount: number
  /** Original recorded weight in its own unit (preserved). */
  recordedWeightValue: number | null
  recordedWeightUnit: string | null
  /** True when grams below are a conversion, not the recorded unit. */
  weightIsDerived: boolean
  grams: number | null
  kilograms: number | null
  pounds: number | null
  averageUnitWeightGrams: number | null
  paymentPerUnit: number | null
  paymentPerGram: number | null
  paymentPerKilogram: number | null
  paymentPerPound: number | null
  /** payment ÷ the ORIGINAL recorded unit (the reliable weight-normalized view). */
  paymentPerRecordedUnit: number | null
}

type MetricsInput = Pick<
  SaleObservationRow,
  'payment_amount' | 'total_units' | 'recorded_weight_value' | 'recorded_weight_unit' | 'weight_is_derived'
>

/** Derive every money metric for one observation. Weight-normalized values are
 *  null when the recorded unit can't be safely converted. */
export function saleMetrics(obs: MetricsInput): SaleMetrics {
  const units = Number(obs.total_units) || 0
  const pay = Number(obs.payment_amount) || 0
  const value = obs.recorded_weight_value == null ? null : Number(obs.recorded_weight_value)
  const unit = obs.recorded_weight_unit ?? null
  const grams = toGrams(value, unit)
  const pounds = gramsToPounds(grams)
  return {
    totalUnits: units,
    paymentAmount: pay,
    recordedWeightValue: value,
    recordedWeightUnit: unit,
    weightIsDerived: Boolean(obs.weight_is_derived),
    grams,
    kilograms: grams == null ? null : grams / KG_TO_G,
    pounds,
    averageUnitWeightGrams: grams != null && units > 0 ? grams / units : null,
    paymentPerUnit: units > 0 ? round2(pay / units) : null,
    paymentPerGram: grams != null && grams > 0 ? round2(pay / grams) : null,
    paymentPerKilogram: grams != null && grams > 0 ? round2(pay / (grams / KG_TO_G)) : null,
    paymentPerPound: pounds != null && pounds > 0 ? round2(pay / pounds) : null,
    paymentPerRecordedUnit: value != null && value > 0 ? round2(pay / value) : null,
  }
}

/* ── Stack reconciliation ─────────────────────────────────────────────────── */
type StackInput = Pick<SaleStackRow, 'units' | 'recorded_weight_value' | 'recorded_weight_unit'>

export interface StackTotals {
  units: number
  /** Sum of stack weights in grams, or null if any stack unit can't convert. */
  grams: number | null
  /** Sum in the shared original unit, when every stack shares one unit. */
  originalValue: number | null
  originalUnit: string | null
}

export function stackTotals(stacks: ReadonlyArray<StackInput>): StackTotals {
  let units = 0
  let grams = 0
  let gramsOk = stacks.length > 0
  let originalValue = 0
  const units0 = stacks.map((s) => (s.recorded_weight_unit ?? '').toLowerCase().trim())
  const sharedUnit = stacks.length > 0 && units0.every((u) => u === units0[0]) ? units0[0] : null
  for (const s of stacks) {
    units += Number(s.units) || 0
    const g = toGrams(s.recorded_weight_value == null ? null : Number(s.recorded_weight_value), s.recorded_weight_unit)
    if (g == null) gramsOk = false
    else grams += g
    if (sharedUnit) originalValue += Number(s.recorded_weight_value) || 0
  }
  return {
    units,
    grams: gramsOk ? round2(grams) : null,
    // Weights (esp. pounds) carry up to 3 decimals — don't clip them to cents.
    originalValue: sharedUnit ? roundTo(originalValue, 3) : null,
    originalUnit: sharedUnit || null,
  }
}

export interface StackReconciliation {
  unitsMatch: boolean
  weightMatch: boolean | null
  stackUnits: number
  observationUnits: number
}

/** Compare stack sums against the observation's recorded totals (warn, never
 *  overwrite). weightMatch is null when weights can't be compared. */
export function reconcileStacks(
  obs: Pick<SaleObservationRow, 'total_units' | 'recorded_weight_value' | 'recorded_weight_unit'>,
  stacks: ReadonlyArray<StackInput>,
): StackReconciliation {
  const totals = stackTotals(stacks)
  const obsGrams = toGrams(obs.recorded_weight_value == null ? null : Number(obs.recorded_weight_value), obs.recorded_weight_unit)
  let weightMatch: boolean | null = null
  if (totals.grams != null && obsGrams != null) {
    weightMatch = Math.abs(totals.grams - obsGrams) <= Math.max(1, obsGrams * 0.005)
  }
  return {
    unitsMatch: totals.units === (Number(obs.total_units) || 0),
    weightMatch,
    stackUnits: totals.units,
    observationUnits: Number(obs.total_units) || 0,
  }
}

/* ── Sample-size confidence (spec Correction · Reliability) ───────────────── */
export type SampleConfidence = 'preliminary' | 'developing' | 'moderate' | 'established'

export function sampleConfidence(n: number): SampleConfidence {
  if (n >= 11) return 'established'
  if (n >= 6) return 'moderate'
  if (n >= 3) return 'developing'
  return 'preliminary'
}

export const SAMPLE_CONFIDENCE_LABEL: Record<SampleConfidence, string> = {
  preliminary: 'Preliminary',
  developing: 'Developing',
  moderate: 'Moderate',
  established: 'Established observational range',
}

/** Short qualifier appended to any headline value while the sample is small. */
export function estimateLabel(n: number): string {
  return n >= 11 ? 'Observed range' : 'Preliminary observed value'
}

/* ── Series statistics ────────────────────────────────────────────────────── */
export interface TierStat {
  tier: string
  count: number
  totalUnits: number
  totalProceeds: number
  avgPaymentPerUnit: number | null
}

export interface SeriesStats {
  count: number
  totalUnits: number
  totalProceeds: number
  averagePaymentPerUnit: number | null
  minPaymentPerUnit: number | null
  maxPaymentPerUnit: number | null
  medianPaymentPerUnit: number | null
  latestPaymentPerUnit: number | null
  latestAt: string | null
  perTier: TierStat[]
  confidence: SampleConfidence
  confidenceLabel: string
  estimateLabel: string
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : round2((s[mid - 1] + s[mid]) / 2)
}

type SeriesObs = Pick<
  SaleObservationRow,
  'payment_amount' | 'total_units' | 'recorded_weight_value' | 'recorded_weight_unit'
  | 'weight_is_derived' | 'quality_tier' | 'observed_at' | 'observation_number'
>

/** Aggregate a series' observations. Payment-per-unit is the primary
 *  comparison; weight-normalized values are deliberately NOT aggregated here. */
export function seriesStats(observations: ReadonlyArray<SeriesObs>): SeriesStats {
  const count = observations.length
  let totalUnits = 0
  let totalProceeds = 0
  const perUnitValues: number[] = []
  const tiers = new Map<string, TierStat>()

  // Latest = highest observation_number, else latest observed_at.
  const ordered = [...observations].sort((a, b) => {
    const an = a.observation_number ?? 0
    const bn = b.observation_number ?? 0
    if (an !== bn) return an - bn
    return (a.observed_at ?? '').localeCompare(b.observed_at ?? '')
  })

  for (const o of observations) {
    const m = saleMetrics(o)
    totalUnits += m.totalUnits
    totalProceeds += m.paymentAmount
    if (m.paymentPerUnit != null) perUnitValues.push(m.paymentPerUnit)
    const tierKey = (o.quality_tier ?? '').trim() || 'Unspecified'
    const t = tiers.get(tierKey) ?? { tier: tierKey, count: 0, totalUnits: 0, totalProceeds: 0, avgPaymentPerUnit: null }
    t.count += 1
    t.totalUnits += m.totalUnits
    t.totalProceeds += m.paymentAmount
    tiers.set(tierKey, t)
  }

  for (const t of tiers.values()) {
    t.avgPaymentPerUnit = t.totalUnits > 0 ? round2(t.totalProceeds / t.totalUnits) : null
  }

  const last = ordered[ordered.length - 1]
  const lastMetrics = last ? saleMetrics(last) : null

  return {
    count,
    totalUnits,
    totalProceeds,
    averagePaymentPerUnit: totalUnits > 0 ? round2(totalProceeds / totalUnits) : null,
    minPaymentPerUnit: perUnitValues.length ? Math.min(...perUnitValues) : null,
    maxPaymentPerUnit: perUnitValues.length ? Math.max(...perUnitValues) : null,
    medianPaymentPerUnit: median(perUnitValues),
    latestPaymentPerUnit: lastMetrics?.paymentPerUnit ?? null,
    latestAt: last?.observed_at ?? null,
    perTier: [...tiers.values()].sort((a, b) => a.tier.localeCompare(b.tier)),
    confidence: sampleConfidence(count),
    confidenceLabel: SAMPLE_CONFIDENCE_LABEL[sampleConfidence(count)],
    estimateLabel: estimateLabel(count),
  }
}

/** Difference of one tier's average $/unit vs another (tier comparison). */
export interface TierComparison {
  a: TierStat
  b: TierStat
  absoluteDelta: number | null
  multiple: number | null
  percentMore: number | null
}

export function compareTiers(a: TierStat | undefined, b: TierStat | undefined): TierComparison | null {
  if (!a || !b || a.avgPaymentPerUnit == null || b.avgPaymentPerUnit == null || a.avgPaymentPerUnit === 0) return null
  const delta = round2(b.avgPaymentPerUnit - a.avgPaymentPerUnit)
  return {
    a, b,
    absoluteDelta: delta,
    multiple: round2(b.avgPaymentPerUnit / a.avgPaymentPerUnit),
    percentMore: round2((delta / a.avgPaymentPerUnit) * 100),
  }
}

/* ── Display vocabulary ───────────────────────────────────────────────────── */
export const PRODUCT_STATE_LABEL: Record<string, string> = {
  wet: 'Wet', dried: 'Dried', bagged: 'Bagged', unknown: 'Unknown state',
}
export const productStateLabel = (s: string | null | undefined): string =>
  PRODUCT_STATE_LABEL[(s ?? '').toLowerCase()] ?? 'Unknown state'

export const PAYMENT_TYPE_LABEL: Record<string, string> = {
  dirty_money: 'Dirty money', cash: 'Cash', bank: 'Bank', unknown: 'Unknown',
}
export const paymentTypeLabel = (s: string | null | undefined): string =>
  PAYMENT_TYPE_LABEL[(s ?? '').toLowerCase()] ?? 'Unknown'

export const SALE_STATE_LABEL: Record<string, string> = {
  draft: 'Draft', confirmed: 'Confirmed', archived: 'Archived', disproven: 'Disproven',
}
export const saleStateLabel = (s: string | null | undefined): string =>
  SALE_STATE_LABEL[(s ?? '').toLowerCase()] ?? 'Draft'

/** Map a sale-observation state → the shared lifecycle keyword `statusTint`
 *  colours (colours stay centralised in lib/tint). */
export function saleStateTintKey(state: string | null | undefined): string {
  switch ((state ?? '').toLowerCase()) {
    case 'confirmed': return 'active'
    case 'draft': return 'open'
    case 'archived': return 'archived'
    case 'disproven': return 'closed'
    default: return ''
  }
}

/** Tier accent — a stable categorical hue per known tier (identity, not rank). */
export function tierTintKey(tier: string | null | undefined): string {
  switch ((tier ?? '').toLowerCase()) {
    case 'fire': return 'closed'      // warm/red accent
    case 'mids': return 'open'        // amber accent
    default: return 'active'
  }
}

export const DATE_PRECISION_LABEL: Record<string, string> = {
  exact: 'Exact', day: 'Approx. day', relative: 'Relative', unknown: 'Unverified',
}
export const datePrecisionLabel = (s: string | null | undefined): string =>
  DATE_PRECISION_LABEL[(s ?? '').toLowerCase()] ?? 'Unverified'

/* ── Screenshot evidence roles ────────────────────────────────────────────── */
export const EVIDENCE_ROLES = [
  'Primary transaction evidence',
  'Supporting product evidence',
  'Supporting calculation evidence',
  'Context-only intelligence',
  'Unrelated / excluded',
  'Needs human review',
] as const

export function isPrimaryEvidence(role: string | null | undefined): boolean {
  return (role ?? '') === 'Primary transaction evidence'
}
export function isSupportingEvidence(role: string | null | undefined): boolean {
  return (role ?? '').startsWith('Supporting')
}
/** Evidence role → lifecycle keyword for the shared tint. */
export function evidenceRoleTintKey(role: string | null | undefined): string {
  if (isPrimaryEvidence(role)) return 'active'
  if (isSupportingEvidence(role)) return 'open'
  if ((role ?? '') === 'Needs human review') return 'closed'
  return ''
}

/** Read the sale-media metadata the import stores in media.tags. */
export interface SaleMediaTags {
  original_filename?: string
  checksum_sha256?: string
  dimensions?: string
  category?: string
  evidence_role?: string
  series_id?: string
  sale_observation_id?: string | null
  tier?: string | null
}

/* ── Validation ───────────────────────────────────────────────────────────── */
export interface ObservationDraft {
  total_units?: number | null
  payment_amount?: number | null
  recorded_weight_value?: number | null
  recorded_weight_unit?: string | null
  product_state?: string | null
  quality_tier?: string | null
}

/** Client-side validation mirror (the server stays the authority). Returns a
 *  list of human-readable problems; empty === valid. Stack mismatch is a
 *  WARNING string prefixed "Warning:" so callers can style it non-blocking. */
export function validateObservationDraft(
  obs: ObservationDraft,
  stacks: ReadonlyArray<StackInput> = [],
): string[] {
  const out: string[] = []
  const units = obs.total_units
  if (units == null || !Number.isInteger(units) || units <= 0) out.push('Units must be a positive whole number.')
  if (obs.payment_amount == null || !(obs.payment_amount >= 0)) out.push('Payment must be zero or more.')
  if (obs.recorded_weight_value != null && !(obs.recorded_weight_value >= 0)) out.push('Weight must be zero or more.')
  if (obs.recorded_weight_value != null && !(obs.recorded_weight_unit ?? '').trim()) out.push('Choose an explicit weight unit.')
  if (obs.recorded_weight_value != null && obs.recorded_weight_unit && toGrams(obs.recorded_weight_value, obs.recorded_weight_unit) == null) {
    out.push(`Unrecognised weight unit “${obs.recorded_weight_unit}”.`)
  }
  if (stacks.length && units != null) {
    const rec = reconcileStacks(
      { total_units: units, recorded_weight_value: obs.recorded_weight_value ?? null, recorded_weight_unit: obs.recorded_weight_unit ?? null },
      stacks,
    )
    if (!rec.unitsMatch) out.push(`Warning: stack units (${rec.stackUnits}) don’t match the recorded total (${rec.observationUnits}).`)
    if (rec.weightMatch === false) out.push('Warning: stack weights don’t match the recorded total weight.')
  }
  return out
}

export function isBlockingError(msg: string): boolean {
  return !msg.startsWith('Warning:')
}
