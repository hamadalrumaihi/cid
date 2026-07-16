import { describe, expect, it } from 'vitest'
import {
  applyNarcoticFilters, buildAliasMap, buildNarcoticMetrics, categoryGlyph, categoryLabel,
  countByNarcotic, isNarcoticStale, narcoticStatusTint, sortNarcotics, statusLabel,
  CATEGORY_PILLS, EMPTY_NARCOTIC_FILTERS, NARCOTIC_CATEGORIES, NARCOTIC_REVIEW_DAYS,
  NARCOTIC_STATUSES, PROVISIONAL_STATUSES,
  type NarcoticFilters, type RegistryNarcotic,
} from './narcoticsRegistry'

const NOW = Date.parse('2026-07-16T00:00:00Z')
const daysAgo = (d: number): string => new Date(NOW - d * 86_400_000).toISOString()

const narc = (over: Partial<RegistryNarcotic> & { id: string }): RegistryNarcotic => ({
  name: 'Blue Dream', classification: null, category: 'cannabis', status: 'confirmed',
  restricted: false, server_specific: false, confidence: null, provenance: null,
  summary: null, appearance: null, packaging: null, icon: null, street_price: null,
  popularity: null, reviewed_at: daysAgo(1), representative_media_id: null,
  merged_into: null, created_at: daysAgo(30), updated_at: daysAgo(1),
  ...over,
})

const filters = (over: Partial<NarcoticFilters> = {}): NarcoticFilters => ({ ...EMPTY_NARCOTIC_FILTERS, ...over })

describe('vocabularies mirror the DB CHECKs', () => {
  it('categories and statuses match the migration', () => {
    expect(NARCOTIC_CATEGORIES).toEqual(['cannabis', 'stimulant', 'opioid', 'sedative', 'hallucinogen', 'synthetic', 'unknown'])
    expect(NARCOTIC_STATUSES).toEqual(['confirmed', 'reported', 'unidentified', 'suspected', 'disproven', 'archived', 'merged'])
    expect([...PROVISIONAL_STATUSES]).toEqual(['reported', 'unidentified', 'suspected'])
  })

  it('CATEGORY_PILLS lead with All then the full vocabulary', () => {
    expect(CATEGORY_PILLS[0]).toEqual({ value: 'all', label: 'All' })
    expect(CATEGORY_PILLS).toHaveLength(NARCOTIC_CATEGORIES.length + 1)
    expect(CATEGORY_PILLS.slice(1).map((p) => p.value)).toEqual([...NARCOTIC_CATEGORIES])
  })

  it('labels and glyphs cover every category, plurals where expected', () => {
    expect(categoryLabel('stimulant')).toBe('Stimulants')
    expect(categoryLabel('synthetic')).toBe('Synthetic')
    expect(categoryLabel(null)).toBe('Unknown')
    for (const c of NARCOTIC_CATEGORIES) expect(categoryGlyph(c)).toBeTruthy()
    expect(categoryGlyph('nonsense')).toBe('❓')
  })

  it('status labels + tints are defined', () => {
    expect(statusLabel('unidentified')).toBe('Unidentified')
    expect(narcoticStatusTint('confirmed')).toContain('emerald')
    expect(narcoticStatusTint('disproven')).toContain('rose')
    expect(narcoticStatusTint('merged')).toContain('slate-400')
  })
})

describe('isNarcoticStale', () => {
  it('is stale when never reviewed or unparseable', () => {
    expect(isNarcoticStale({ reviewed_at: null }, NOW)).toBe(true)
    expect(isNarcoticStale({ reviewed_at: 'not-a-date' }, NOW)).toBe(true)
  })
  it('honours the review threshold', () => {
    expect(isNarcoticStale({ reviewed_at: daysAgo(NARCOTIC_REVIEW_DAYS - 1) }, NOW)).toBe(false)
    expect(isNarcoticStale({ reviewed_at: daysAgo(NARCOTIC_REVIEW_DAYS + 1) }, NOW)).toBe(true)
  })
})

describe('rollups', () => {
  it('countByNarcotic tallies per id', () => {
    const m = countByNarcotic([{ narcotic_id: 'a' }, { narcotic_id: 'a' }, { narcotic_id: 'b' }])
    expect(m.get('a')).toBe(2)
    expect(m.get('b')).toBe(1)
    expect(m.get('c')).toBeUndefined()
  })
  it('buildAliasMap preserves order and groups by id', () => {
    const m = buildAliasMap([
      { narcotic_id: 'a', alias: 'Zaza' }, { narcotic_id: 'a', alias: 'Loud' }, { narcotic_id: 'b', alias: 'Snow' },
    ])
    expect(m.get('a')).toEqual(['Zaza', 'Loud'])
    expect(m.get('b')).toEqual(['Snow'])
  })
})

describe('buildNarcoticMetrics', () => {
  it('counts confirmed, provisional (incl. unknown category) and review-due', () => {
    const rows = [
      narc({ id: '1', status: 'confirmed', reviewed_at: daysAgo(1) }),
      narc({ id: '2', status: 'suspected', reviewed_at: daysAgo(1) }),
      narc({ id: '3', status: 'confirmed', category: 'unknown', reviewed_at: daysAgo(1) }),
      narc({ id: '4', status: 'confirmed', reviewed_at: null }),
    ]
    const m = buildNarcoticMetrics(rows, NOW)
    expect(m.total).toBe(4)
    expect(m.confirmed).toBe(3)
    expect(m.provisional).toBe(2) // #2 (suspected) + #3 (unknown category)
    expect(m.reviewDue).toBe(1) // #4 never reviewed
  })
})

describe('applyNarcoticFilters', () => {
  const rows = [
    narc({ id: 'weed', category: 'cannabis', status: 'confirmed' }),
    narc({ id: 'meth', category: 'stimulant', status: 'suspected', server_specific: true }),
    narc({ id: 'fent', category: 'opioid', status: 'confirmed', restricted: true, reviewed_at: null }),
    narc({ id: 'ghost', category: 'unknown', status: 'merged' }),
  ]

  it('always drops merged tombstones', () => {
    const out = applyNarcoticFilters(rows, 'all', filters(), NOW)
    expect(out.map((n) => n.id)).not.toContain('ghost')
    expect(out).toHaveLength(3)
  })
  it('filters by category', () => {
    expect(applyNarcoticFilters(rows, 'opioid', filters(), NOW).map((n) => n.id)).toEqual(['fent'])
  })
  it('filters by exact status', () => {
    expect(applyNarcoticFilters(rows, 'all', filters({ status: 'confirmed' }), NOW).map((n) => n.id)).toEqual(['weed', 'fent'])
  })
  it('filters provisional, server-specific, restricted, review-due', () => {
    expect(applyNarcoticFilters(rows, 'all', filters({ provisional: true }), NOW).map((n) => n.id)).toEqual(['meth'])
    expect(applyNarcoticFilters(rows, 'all', filters({ serverSpecific: true }), NOW).map((n) => n.id)).toEqual(['meth'])
    expect(applyNarcoticFilters(rows, 'all', filters({ restricted: true }), NOW).map((n) => n.id)).toEqual(['fent'])
    expect(applyNarcoticFilters(rows, 'all', filters({ reviewDue: true }), NOW).map((n) => n.id)).toEqual(['fent'])
  })
})

describe('sortNarcotics', () => {
  const rows = [
    narc({ id: 'a', name: 'Charlie', updated_at: daysAgo(5), reviewed_at: daysAgo(10), popularity: 1, street_price: 50 }),
    narc({ id: 'b', name: 'Alpha', updated_at: daysAgo(1), reviewed_at: daysAgo(2), popularity: 9, street_price: 500 }),
    narc({ id: 'c', name: 'Bravo', updated_at: daysAgo(3), reviewed_at: null, popularity: 5, street_price: 100 }),
  ]

  it('sorts by name', () => {
    expect(sortNarcotics(rows, 'name').map((n) => n.name)).toEqual(['Alpha', 'Bravo', 'Charlie'])
  })
  it('sorts by recently updated', () => {
    expect(sortNarcotics(rows, 'updated').map((n) => n.id)).toEqual(['b', 'c', 'a'])
  })
  it('sorts most-stale first (never-reviewed leads)', () => {
    expect(sortNarcotics(rows, 'staleness')[0].id).toBe('c')
  })
  it('sorts by popularity and price descending', () => {
    expect(sortNarcotics(rows, 'popularity').map((n) => n.id)).toEqual(['b', 'c', 'a'])
    expect(sortNarcotics(rows, 'price').map((n) => n.id)).toEqual(['b', 'c', 'a'])
  })
  it('does not mutate the input array', () => {
    const before = rows.map((n) => n.id)
    sortNarcotics(rows, 'name')
    expect(rows.map((n) => n.id)).toEqual(before)
  })
})
