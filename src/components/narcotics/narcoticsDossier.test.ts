import { describe, expect, it } from 'vitest'
import {
  CASE_RELATION_LABEL, NARCOTIC_REVIEW_DAYS, NARCOTIC_SUGGESTION_TYPES,
  PRODUCTION_ROLES, SECTION_IDS,
  buildNarcoticActivity, isNarcoticStale, isPossibleMention, isProductionRole,
  linkStatusLabel, narcoticSuggestionFormError, narcoticSuggestionParams,
  parseChargeCodes, resolveCharges, sectionFromParam, seizureStateLabel,
  statusTintKey,
} from './narcoticsDossier'

const DAY = 86_400_000
const NOW = Date.parse('2026-07-16T00:00:00Z')

describe('section whitelist + URL guard', () => {
  it('exposes the ten spec sections', () => {
    expect(SECTION_IDS).toHaveLength(11)
    expect(SECTION_IDS).toContain('intelligence')
    expect(SECTION_IDS).toContain('people')
    expect(SECTION_IDS).toContain('sales')
  })

  it('defaults unknown/absent to overview, keeps valid ids', () => {
    expect(sectionFromParam(null)).toBe('overview')
    expect(sectionFromParam('bogus')).toBe('overview')
    expect(sectionFromParam('')).toBe('overview')
    expect(sectionFromParam('seizures')).toBe('seizures')
    expect(sectionFromParam('activity')).toBe('activity')
  })
})

describe('staleness', () => {
  it('treats never-reviewed and unparseable as stale', () => {
    expect(isNarcoticStale(null, NOW)).toBe(true)
    expect(isNarcoticStale('not-a-date', NOW)).toBe(true)
  })

  it('flags stale only past the threshold', () => {
    const fresh = new Date(NOW - 10 * DAY).toISOString()
    const old = new Date(NOW - (NARCOTIC_REVIEW_DAYS + 5) * DAY).toISOString()
    expect(isNarcoticStale(fresh, NOW)).toBe(false)
    expect(isNarcoticStale(old, NOW)).toBe(true)
  })
})

describe('display vocabulary', () => {
  it('maps status to canonical tint keys', () => {
    expect(statusTintKey('provisional')).toBe('open')
    expect(statusTintKey('confirmed')).toBe('active')
    expect(statusTintKey('merged')).toBe('archived')
    expect(statusTintKey('disproven')).toBe('closed')
  })

  it('labels seizure states verbatim-friendly', () => {
    expect(seizureStateLabel('lab_confirmed')).toBe('Lab confirmed')
    expect(seizureStateLabel('suspected')).toBe('Suspected')
  })

  it('flags possible mentions distinctly', () => {
    expect(isPossibleMention('possible_mention')).toBe(true)
    expect(linkStatusLabel('possible_mention')).toBe('Possible mention')
    expect(linkStatusLabel('confirmed')).toBe('Confirmed')
    expect(isPossibleMention('confirmed')).toBe(false)
  })

  it('recognises production roles for the intelligence section', () => {
    expect(PRODUCTION_ROLES).toContain('cultivated_at')
    expect(isProductionRole('processed_at')).toBe(true)
    expect(isProductionRole('sold_at')).toBe(false)
  })

  it('labels every case relation', () => {
    expect(CASE_RELATION_LABEL.linked).toMatch(/confirmed/i)
    expect(CASE_RELATION_LABEL.mention).toMatch(/mention/i)
  })
})

describe('charge resolution (§13)', () => {
  it('parses, trims, and de-dupes code strings', () => {
    expect(parseChargeCodes(['(6)01', ' (6)01 ', '', '(6)02'])).toEqual(['(6)01', '(6)02'])
    expect(parseChargeCodes(null)).toEqual([])
    expect(parseChargeCodes('nope' as unknown as string[])).toEqual([])
  })

  it('resolves known codes and surfaces unknowns with null', () => {
    const res = resolveCharges(['(1)05', '(99)99'])
    expect(res[0].code).toBe('(1)05')
    expect(res[0].charge?.title).toMatch(/murder/i)
    expect(res[1].charge).toBeNull()
  })
})

describe('activity timeline', () => {
  it('assembles newest-first from row dates + children, resolving actors', () => {
    const entries = buildNarcoticActivity(
      {
        created_at: '2026-01-01T00:00:00Z',
        created_by: 'u1',
        updated_at: '2026-03-01T00:00:00Z',
        reviewed_at: '2026-05-01T00:00:00Z',
        reviewed_by: 'u2',
        first_recorded_at: null,
        last_confirmed_at: null,
      },
      {
        seizures: [{ id: 's1', created_at: '2026-04-01T00:00:00Z', state: 'confirmed', location: 'Docks' }],
        media: [{ id: 'm1', created_at: '2026-02-01T00:00:00Z', title: 'Baggie' }],
      },
      (id) => (id === 'u1' ? 'Det. A' : id === 'u2' ? 'Sgt. B' : null),
    )
    expect(entries[0].id).toBe('reviewed')
    expect(entries[0].actor).toBe('Sgt. B')
    expect(entries[entries.length - 1].id).toBe('created')
    expect(entries[entries.length - 1].actor).toBe('Det. A')
    // newest-first ordering holds across the merged sources
    const times = entries.map((e) => Date.parse(e.at))
    expect([...times]).toEqual([...times].sort((a, b) => b - a))
  })
})

describe('suggestion vocabulary + params', () => {
  it('exposes all eleven suggestion types', () => {
    expect(NARCOTIC_SUGGESTION_TYPES).toHaveLength(11)
    expect(NARCOTIC_SUGGESTION_TYPES).toContain('missing_charge_link')
    expect(NARCOTIC_SUGGESTION_TYPES).toContain('new_substance')
  })

  it('builds params, trimming and nulling empties, keeping ids', () => {
    const p = narcoticSuggestionParams({
      narcoticId: 'n1', type: 'missing_alias', title: '  Add "snow" ',
      explanation: ' commonly used ', proposedValue: '   ', sourceCaseId: ' c1 ',
    })
    expect(p.p_narcotic).toBe('n1')
    expect(p.p_title).toBe('Add "snow"')
    expect(p.p_explanation).toBe('commonly used')
    expect(p.p_proposed_value).toBeNull()
    expect(p.p_source_case).toBe('c1')
    expect(p.p_source_evidence).toBeNull()
  })

  it('flags missing required fields', () => {
    expect(narcoticSuggestionFormError({ type: '', title: 'x', explanation: 'y' })).toMatch(/kind/i)
    expect(narcoticSuggestionFormError({ type: 'other', title: '', explanation: 'y' })).toMatch(/title/i)
    expect(narcoticSuggestionFormError({ type: 'other', title: 'x', explanation: '' })).toMatch(/explain/i)
    expect(narcoticSuggestionFormError({ type: 'other', title: 'x', explanation: 'y' })).toBeNull()
  })
})
