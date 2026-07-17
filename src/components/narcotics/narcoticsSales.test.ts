import { describe, it, expect } from 'vitest'
import {
  toGrams, gramsToPounds, round2, saleMetrics, stackTotals, reconcileStacks,
  sampleConfidence, SAMPLE_CONFIDENCE_LABEL, seriesStats, compareTiers,
  isPrimaryEvidence, isSupportingEvidence, EVIDENCE_ROLES,
  validateObservationDraft, isBlockingError, formatProceeds, formatMoney,
  productStateLabel, paymentTypeLabel, saleStateLabel,
} from './narcoticsSales'

// The two imported LeafOS observations, as DB-shaped rows.
const SALE1 = {
  payment_amount: 15584, total_units: 70,
  recorded_weight_value: 4410, recorded_weight_unit: 'g', weight_is_derived: false,
  quality_tier: 'Mids', observed_at: '2026-07-15T12:00:00Z', observation_number: 1,
}
const SALE1_STACKS = [
  { units: 8, recorded_weight_value: 504, recorded_weight_unit: 'g' },
  { units: 10, recorded_weight_value: 630, recorded_weight_unit: 'g' },
  { units: 8, recorded_weight_value: 504, recorded_weight_unit: 'g' },
  { units: 13, recorded_weight_value: 819, recorded_weight_unit: 'g' },
  { units: 11, recorded_weight_value: 693, recorded_weight_unit: 'g' },
  { units: 9, recorded_weight_value: 567, recorded_weight_unit: 'g' },
  { units: 11, recorded_weight_value: 693, recorded_weight_unit: 'g' },
]
const SALE2 = {
  payment_amount: 39208, total_units: 72,
  recorded_weight_value: 4.176, recorded_weight_unit: 'lb', weight_is_derived: true,
  quality_tier: 'Fire', observed_at: '2026-07-16T12:00:00Z', observation_number: 2,
}
const SALE2_STACKS = [
  { units: 51, recorded_weight_value: 2.958, recorded_weight_unit: 'lb' },
  { units: 21, recorded_weight_value: 1.218, recorded_weight_unit: 'lb' },
]

describe('unit conversion', () => {
  it('converts g / kg / lb / oz to grams and rejects unknown units', () => {
    expect(toGrams(4410, 'g')).toBe(4410)
    expect(toGrams(4.41, 'kg')).toBe(4410)
    expect(toGrams(1, 'lb')).toBeCloseTo(453.59237, 5)
    expect(toGrams(1, 'oz')).toBeCloseTo(28.3495, 3)
    expect(toGrams(1, 'buckets')).toBeNull()
    expect(toGrams(null, 'g')).toBeNull()
  })
  it('round-trips lb → g → lb', () => {
    expect(gramsToPounds(toGrams(4.176, 'lb'))).toBeCloseTo(4.176, 6)
  })
})

describe('Sale 1 — Mids', () => {
  it('stacks total 70 units / 4,410 g', () => {
    const t = stackTotals(SALE1_STACKS)
    expect(t.units).toBe(70)
    expect(t.grams).toBe(4410)
  })
  it('stack sums reconcile with the recorded totals', () => {
    const r = reconcileStacks(SALE1, SALE1_STACKS)
    expect(r.unitsMatch).toBe(true)
    expect(r.weightMatch).toBe(true)
  })
  it('derives payment metrics exactly', () => {
    const m = saleMetrics(SALE1)
    expect(m.paymentPerUnit).toBe(222.63)
    expect(m.paymentPerGram).toBe(3.53)
    // NB: the spec printed $3,534.92/kg, but that is inconsistent with its own
    // $3.53/g (15584 ÷ 4.41 kg = 3533.79). The workspace shows the reproducible
    // value derived from the raw proceeds and grams.
    expect(m.paymentPerKilogram).toBe(3533.79)
    expect(m.averageUnitWeightGrams).toBe(63)
    expect(m.weightIsDerived).toBe(false)
  })
})

describe('Sale 2 — Fire — pounds preserved, grams derived', () => {
  it('stacks total 72 units / 4.176 lb', () => {
    const t = stackTotals(SALE2_STACKS)
    expect(t.units).toBe(72)
    expect(t.originalValue).toBe(4.176)
    expect(t.originalUnit).toBe('lb')
  })
  it('reconciles', () => {
    const r = reconcileStacks(SALE2, SALE2_STACKS)
    expect(r.unitsMatch).toBe(true)
    expect(r.weightMatch).toBe(true)
  })
  it('derives payment metrics; pound is the original unit', () => {
    const m = saleMetrics(SALE2)
    expect(m.paymentPerUnit).toBe(544.56)
    expect(m.paymentPerPound).toBe(9388.89)
    expect(m.paymentPerGram).toBe(20.70)
    expect(m.paymentPerKilogram).toBeCloseTo(20698.96, 0)
    expect(m.averageUnitWeightGrams).toBeCloseTo(26.3, 1)
    expect(m.weightIsDerived).toBe(true)
    expect(m.recordedWeightUnit).toBe('lb')
  })
})

describe('combined + tier comparison', () => {
  const stats = seriesStats([SALE1, SALE2])
  it('combined totals', () => {
    expect(stats.count).toBe(2)
    expect(stats.totalUnits).toBe(142)
    expect(stats.totalProceeds).toBe(54792)
    expect(stats.averagePaymentPerUnit).toBe(385.86)
  })
  it('min / max / median / latest payment per unit', () => {
    expect(stats.minPaymentPerUnit).toBe(222.63)
    expect(stats.maxPaymentPerUnit).toBe(544.56)
    expect(stats.medianPaymentPerUnit).toBe(383.6)
    expect(stats.latestPaymentPerUnit).toBe(544.56) // Fire is observation #2
  })
  it('per-tier averages', () => {
    const mids = stats.perTier.find((t) => t.tier === 'Mids')!
    const fire = stats.perTier.find((t) => t.tier === 'Fire')!
    expect(mids.avgPaymentPerUnit).toBe(222.63)
    expect(fire.avgPaymentPerUnit).toBe(544.56)
    const cmp = compareTiers(mids, fire)!
    expect(cmp.absoluteDelta).toBe(321.93)
    expect(cmp.multiple).toBe(2.45)
    expect(cmp.percentMore).toBe(144.6)
  })
})

describe('sample-size confidence', () => {
  it('maps counts to the four bands', () => {
    expect(sampleConfidence(1)).toBe('preliminary')
    expect(sampleConfidence(2)).toBe('preliminary')
    expect(sampleConfidence(3)).toBe('developing')
    expect(sampleConfidence(5)).toBe('developing')
    expect(sampleConfidence(6)).toBe('moderate')
    expect(sampleConfidence(10)).toBe('moderate')
    expect(sampleConfidence(11)).toBe('established')
    expect(sampleConfidence(50)).toBe('established')
  })
  it('two observations read as Preliminary', () => {
    expect(SAMPLE_CONFIDENCE_LABEL[seriesStats([SALE1, SALE2]).confidence]).toBe('Preliminary')
  })
})

describe('evidence roles', () => {
  it('classifies primary vs supporting', () => {
    expect(isPrimaryEvidence('Primary transaction evidence')).toBe(true)
    expect(isPrimaryEvidence('Supporting product evidence')).toBe(false)
    expect(isSupportingEvidence('Supporting calculation evidence')).toBe(true)
    expect(isSupportingEvidence('Context-only intelligence')).toBe(false)
  })
  it('vocabulary is the six roles', () => {
    expect(EVIDENCE_ROLES).toHaveLength(6)
    expect(EVIDENCE_ROLES).toContain('Needs human review')
  })
})

describe('validation', () => {
  it('accepts a valid draft', () => {
    expect(validateObservationDraft(
      { total_units: 70, payment_amount: 15584, recorded_weight_value: 4410, recorded_weight_unit: 'g' },
      SALE1_STACKS,
    )).toEqual([])
  })
  it('rejects non-positive units and negative payment', () => {
    const errs = validateObservationDraft({ total_units: 0, payment_amount: -1 })
    expect(errs.some((e) => e.includes('Units'))).toBe(true)
    expect(errs.some((e) => e.includes('Payment'))).toBe(true)
    expect(errs.every(isBlockingError)).toBe(true)
  })
  it('requires an explicit unit and flags unknown units', () => {
    expect(validateObservationDraft({ total_units: 5, payment_amount: 10, recorded_weight_value: 3, recorded_weight_unit: '' })
      .some((e) => e.includes('explicit weight unit'))).toBe(true)
    expect(validateObservationDraft({ total_units: 5, payment_amount: 10, recorded_weight_value: 3, recorded_weight_unit: 'blob' })
      .some((e) => e.includes('Unrecognised'))).toBe(true)
  })
  it('warns (non-blocking) on stack/total mismatch', () => {
    const errs = validateObservationDraft(
      { total_units: 99, payment_amount: 10, recorded_weight_value: 4410, recorded_weight_unit: 'g' },
      SALE1_STACKS,
    )
    const warn = errs.find((e) => e.startsWith('Warning:'))
    expect(warn).toBeTruthy()
    expect(isBlockingError(warn!)).toBe(false)
  })
})

describe('formatting + labels', () => {
  it('proceeds keep whole dollars; metrics keep cents', () => {
    expect(formatProceeds(39208)).toBe('$39,208')
    expect(formatProceeds(54792)).toBe('$54,792')
    expect(formatMoney(222.63)).toBe('$222.63')
    expect(formatMoney(null)).toBe('—')
  })
  it('labels', () => {
    expect(productStateLabel('bagged')).toBe('Bagged')
    expect(paymentTypeLabel('dirty_money')).toBe('Dirty money')
    expect(saleStateLabel('confirmed')).toBe('Confirmed')
  })
  it('round2 is stable', () => {
    expect(round2(222.6285714)).toBe(222.63)
    expect(round2(0.1 + 0.2)).toBe(0.3)
  })
})
