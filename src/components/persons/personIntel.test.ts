import { describe, expect, it } from 'vitest'
import {
  boloState, CLASSIFICATION_LABELS, classificationLabel, CONFIDENCE_LABELS, CONFIDENCE_LEVELS,
  duplicatePersonIds, findDuplicatePersons, isLegalActive, isPersonStale, legalStatusOf,
  LIFECYCLE_LABELS, LINK_STATUS_LABELS, LINK_STATUSES, normalizeName, parsePersonIdentity,
  PERSON_CLASSIFICATIONS, PERSON_LIFECYCLES, PERSON_PRIORITIES, PERSON_REVIEW_DAYS,
  PERSON_SUMMARY_SECTIONS, personQualityWarnings, PLACE_ROLE_LABELS, PLACE_ROLES,
  planPersonMerge, PRIORITY_LABELS, RELATIONSHIP_LABELS, RELATIONSHIP_TYPES, relationshipLabel,
  reviewDueState, VEHICLE_ROLE_LABELS, VEHICLE_ROLES,
  type LegalLite, type PersonRowLike,
} from './personIntel'

const person = (over: Partial<PersonRowLike> & { id: string }): PersonRowLike => ({
  name: 'Trey Sanders', alias: null, dob: null, phone: null, mugshot_url: null,
  gang_id: null, classification: null, confidence: null, priority: null, status: null,
  lifecycle: 'active', merged_into: null, identity: {},
  bolo: false, bolo_reason: null, bolo_risk: null, bolo_expires_at: null,
  reviewed_at: null, next_review_at: null,
  ...over,
})

const legal = (over: Partial<LegalLite> & { id: string }): LegalLite => ({
  request_type: 'warrant', subtype: 'arrest_warrant', review_status: 'approved',
  fulfilment_status: 'issued', response_deadline: null, expires_at: null,
  request_number: 'LR-26-001', case_id: 'c1', created_at: '2026-07-01T00:00:00Z',
  ...over,
})

const NOW = Date.parse('2026-07-15T00:00:00Z')
const TODAY = '2026-07-15'

describe('vocabularies and label maps', () => {
  it('mirrors the DB CHECK vocabularies exactly', () => {
    expect(PERSON_CLASSIFICATIONS).toEqual(['person_of_interest', 'suspect', 'witness', 'victim', 'informant', 'associate', 'other'])
    expect(PERSON_LIFECYCLES).toEqual(['active', 'inactive', 'historical', 'cleared', 'archived', 'merged'])
    expect(PERSON_PRIORITIES).toEqual(['low', 'medium', 'high', 'critical'])
    expect(RELATIONSHIP_TYPES).toHaveLength(11)
    expect(PLACE_ROLES).toHaveLength(10)
    expect(VEHICLE_ROLES).toHaveLength(7)
    expect(LINK_STATUSES).toEqual(['current', 'historical', 'disputed'])
    expect(CONFIDENCE_LEVELS).toEqual(['confirmed', 'probable', 'possible', 'unverified', 'disproven'])
  })
  it('every vocabulary value has a Title Case label in its map', () => {
    const pairs: Array<[readonly string[], Record<string, string>]> = [
      [PERSON_CLASSIFICATIONS, CLASSIFICATION_LABELS], [PERSON_LIFECYCLES, LIFECYCLE_LABELS],
      [PERSON_PRIORITIES, PRIORITY_LABELS], [RELATIONSHIP_TYPES, RELATIONSHIP_LABELS],
      [PLACE_ROLES, PLACE_ROLE_LABELS], [VEHICLE_ROLES, VEHICLE_ROLE_LABELS],
      [LINK_STATUSES, LINK_STATUS_LABELS], [CONFIDENCE_LEVELS, CONFIDENCE_LABELS],
    ]
    for (const [vocab, map] of pairs) {
      for (const v of vocab) expect(map[v], v).toMatch(/^[A-Z][A-Za-z ]*$/)
      expect(map[v0(vocab)]).not.toContain('_')
    }
    expect(RELATIONSHIP_LABELS.co_suspect).toBe('Co Suspect')
    expect(CLASSIFICATION_LABELS.person_of_interest).toBe('Person Of Interest')
  })
  it('label helpers humanize unknown legacy values and blank out null', () => {
    expect(classificationLabel('some_legacy_value')).toBe('Some Legacy Value')
    expect(relationshipLabel(null)).toBe('')
    expect(classificationLabel('suspect')).toBe('Suspect')
  })
  it('summary sections carry the agreed keys in reading order', () => {
    expect(PERSON_SUMMARY_SECTIONS.map((s) => s.key)).toEqual([
      'executive_summary', 'current_relevance', 'known_activities', 'modus_operandi',
      'affiliations', 'risk_considerations', 'recent_encounters', 'intelligence_gaps', 'source_notes',
    ])
    for (const s of PERSON_SUMMARY_SECTIONS) expect(s.label).toBeTruthy()
  })
})

const v0 = (vocab: readonly string[]) => vocab.find((v) => v.includes('_')) ?? vocab[0]

describe('parsePersonIdentity', () => {
  it('degrades null/undefined/garbage to an empty identity', () => {
    const empty = { aliases: [], street_names: [], occupation: '', distinguishing: [], license_ids: [], notes: '' }
    expect(parsePersonIdentity(null)).toEqual(empty)
    expect(parsePersonIdentity(undefined)).toEqual(empty)
    expect(parsePersonIdentity('garbage')).toEqual(empty)
    expect(parsePersonIdentity(['not', 'an', 'object'])).toEqual(empty)
    expect(parsePersonIdentity(42)).toEqual(empty)
  })
  it('keeps only trimmed non-empty strings in the array fields', () => {
    const idn = parsePersonIdentity({ aliases: [' T-Bone ', 7, null, '', 'Ghost'], street_names: 'not-an-array' })
    expect(idn.aliases).toEqual(['T-Bone', 'Ghost'])
    expect(idn.street_names).toEqual([])
  })
  it('coerces the free-text fields and tolerates partial shapes', () => {
    const idn = parsePersonIdentity({ occupation: '  mechanic ', notes: 9, license_ids: ['DL-1'] })
    expect(idn.occupation).toBe('mechanic')
    expect(idn.notes).toBe('')
    expect(idn.license_ids).toEqual(['DL-1'])
    expect(idn.distinguishing).toEqual([])
  })
})

describe('isPersonStale / reviewDueState', () => {
  const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString()
  it('is stale when never reviewed', () => {
    expect(isPersonStale(null, NOW)).toBe(true)
    expect(isPersonStale('not-a-date', NOW)).toBe(true)
  })
  it('flips exactly at the 90-day threshold (89 fresh, 90/91 stale)', () => {
    expect(PERSON_REVIEW_DAYS).toBe(90)
    expect(isPersonStale(daysAgo(89), NOW)).toBe(false)
    expect(isPersonStale(daysAgo(90), NOW)).toBe(true)
    expect(isPersonStale(daysAgo(91), NOW)).toBe(true)
  })
  it('honours a custom threshold', () => {
    expect(isPersonStale(daysAgo(10), NOW, 30)).toBe(false)
    expect(isPersonStale(daysAgo(30), NOW, 30)).toBe(true)
  })
  it('reviewDueState: unreviewed when reviewed_at is null (even with a future next_review_at)', () => {
    expect(reviewDueState({ reviewed_at: null, next_review_at: '2026-12-01T00:00:00Z' }, NOW)).toBe('unreviewed')
  })
  it('reviewDueState: due when next_review_at has passed, even if recently reviewed', () => {
    expect(reviewDueState({ reviewed_at: daysAgo(1), next_review_at: '2026-07-10T00:00:00Z' }, NOW)).toBe('due')
  })
  it('reviewDueState: stale past the threshold, fresh inside it', () => {
    expect(reviewDueState({ reviewed_at: daysAgo(90), next_review_at: null }, NOW)).toBe('stale')
    expect(reviewDueState({ reviewed_at: daysAgo(89), next_review_at: null }, NOW)).toBe('fresh')
    expect(reviewDueState({ reviewed_at: daysAgo(1), next_review_at: '2026-12-01T00:00:00Z' }, NOW)).toBe('fresh')
  })
})

describe('boloState', () => {
  it('no BOLO → inactive with nulled display fields', () => {
    expect(boloState(person({ id: 'a', bolo: false, bolo_reason: 'stale text', bolo_risk: 'high' }), TODAY))
      .toEqual({ active: false, expired: false, risk: null, reason: null, expiresAt: null })
  })
  it('active BOLO passes risk/reason/expiry through', () => {
    const s = boloState(person({ id: 'a', bolo: true, bolo_reason: ' Armed robbery suspect ', bolo_risk: 'critical', bolo_expires_at: '2026-08-01' }), TODAY)
    expect(s).toEqual({ active: true, expired: false, risk: 'critical', reason: 'Armed robbery suspect', expiresAt: '2026-08-01' })
  })
  it('expired = still active (shows, flagged) when bolo_expires_at is before today', () => {
    const s = boloState(person({ id: 'a', bolo: true, bolo_expires_at: '2026-07-14' }), TODAY)
    expect(s.active).toBe(true)
    expect(s.expired).toBe(true)
  })
  it('an expiry of today or no expiry is not expired; blank reason → null', () => {
    expect(boloState(person({ id: 'a', bolo: true, bolo_expires_at: '2026-07-15' }), TODAY).expired).toBe(false)
    const s = boloState(person({ id: 'a', bolo: true, bolo_reason: '   ' }), TODAY)
    expect(s.expired).toBe(false)
    expect(s.reason).toBeNull()
  })
})

describe('legalStatusOf / isLegalActive', () => {
  it('classifies by request_type + subtype into the five buckets', () => {
    const rows = [
      legal({ id: 'aw', request_type: 'warrant', subtype: 'arrest_warrant' }),
      legal({ id: 'sw', request_type: 'warrant', subtype: 'search_warrant' }),
      legal({ id: 'sp', request_type: 'subpoena', subtype: 'phone_records' }),
      legal({ id: 'sv', request_type: 'subpoena', subtype: 'surveillance_cctv' }),
      legal({ id: 'ot', request_type: 'mystery', subtype: 'other' }),
    ]
    const s = legalStatusOf(rows, TODAY)
    expect(s.arrestWarrants.map((r) => r.id)).toEqual(['aw'])
    expect(s.searchWarrants.map((r) => r.id)).toEqual(['sw'])
    expect(s.subpoenas.map((r) => r.id)).toEqual(['sp'])
    expect(s.surveillance.map((r) => r.id)).toEqual(['sv'])
    expect(s.other.map((r) => r.id)).toEqual(['ot'])
    expect(s.activeCount).toBe(5)
  })
  it('terminal review states are kept in their bucket but excluded from activeCount', () => {
    const rows = ['denied', 'withdrawn', 'closed', 'approved'].map((review_status, i) =>
      legal({ id: `r${i}`, review_status }))
    const s = legalStatusOf(rows, TODAY)
    expect(s.arrestWarrants).toHaveLength(4)
    expect(s.activeCount).toBe(1)
  })
  it('done fulfilment states are excluded from activeCount', () => {
    for (const fulfilment_status of ['closed', 'returned', 'return_recorded', 'revoked', 'expired'])
      expect(isLegalActive(legal({ id: 'x', fulfilment_status }), TODAY)).toBe(false)
    for (const fulfilment_status of ['unissued', 'issued', 'executed', 'served', 'compliance_pending'])
      expect(isLegalActive(legal({ id: 'x', fulfilment_status }), TODAY)).toBe(true)
  })
  it('a past expires_at deactivates even when the statuses were never flipped', () => {
    expect(isLegalActive(legal({ id: 'x', expires_at: '2026-07-14T00:00:00Z' }), TODAY)).toBe(false)
    expect(isLegalActive(legal({ id: 'x', expires_at: '2026-07-15T00:00:00Z' }), TODAY)).toBe(true)
  })
})

describe('normalizeName', () => {
  it('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalizeName('  Trey-Sanders! ')).toBe('trey sanders')
    expect(normalizeName(null)).toBe('')
  })
})

describe('findDuplicatePersons', () => {
  it('strong: same normalized name + same dob', () => {
    const clusters = findDuplicatePersons([
      person({ id: 'a', name: 'Trey Sanders', dob: '1990-01-01' }),
      person({ id: 'b', name: 'trey  sanders', dob: '1990-01-01' }),
      person({ id: 'c', name: 'Someone Else', dob: '1990-01-01' }),
    ])
    expect(clusters).toHaveLength(1)
    expect(clusters[0]).toMatchObject({ ids: ['a', 'b'], confidence: 'strong' })
    expect(clusters[0].signals.map((s) => s.kind)).toContain('dob')
  })
  it('strong: same phone digits regardless of formatting', () => {
    const clusters = findDuplicatePersons([
      person({ id: 'a', name: 'A One', phone: '(555) 010-0199' }),
      person({ id: 'b', name: 'B Two', phone: '5550100199' }),
    ])
    expect(clusters[0]).toMatchObject({ ids: ['a', 'b'], confidence: 'strong' })
    expect(clusters[0].signals.map((s) => s.kind)).toEqual(['phone'])
  })
  it('strong: same mugshot_url', () => {
    const clusters = findDuplicatePersons([
      person({ id: 'a', name: 'A One', mugshot_url: 'https://cdn/x.png' }),
      person({ id: 'b', name: 'B Two', mugshot_url: 'https://cdn/x.png' }),
    ])
    expect(clusters[0]).toMatchObject({ ids: ['a', 'b'], confidence: 'strong' })
    expect(clusters[0].signals.map((s) => s.kind)).toEqual(['mugshot'])
  })
  it("strong: alias column matching the other record's name", () => {
    const clusters = findDuplicatePersons([
      person({ id: 'a', name: 'Trey Sanders', alias: 'T. Bone' }),
      person({ id: 'b', name: 'T-Bone' }),
    ])
    expect(clusters[0]).toMatchObject({ ids: ['a', 'b'], confidence: 'strong' })
    expect(clusters[0].signals.map((s) => s.kind)).toEqual(['alias'])
  })
  it('strong: identity.aliases / street_names also match names', () => {
    const clusters = findDuplicatePersons([
      person({ id: 'a', name: 'Trey Sanders', identity: { street_names: ['Ghost'] } }),
      person({ id: 'b', name: 'Ghost' }),
    ])
    expect(clusters[0]).toMatchObject({ ids: ['a', 'b'], confidence: 'strong' })
  })
  it('possible: same normalized name alone (no dob corroboration)', () => {
    const clusters = findDuplicatePersons([
      person({ id: 'a', name: 'Trey Sanders', dob: '1990-01-01' }),
      person({ id: 'b', name: 'Trey Sanders', dob: '1991-06-06' }),
    ])
    expect(clusters[0]).toMatchObject({ ids: ['a', 'b'], confidence: 'possible' })
    expect(clusters[0].signals.map((s) => s.kind)).toEqual(['name'])
  })
  it('possible: similar name in the same gang — but not across gangs', () => {
    const sameGang = findDuplicatePersons([
      person({ id: 'a', name: 'Trey Sanders', gang_id: 'g1' }),
      person({ id: 'b', name: 'T Sanders', gang_id: 'g1' }),
    ])
    expect(sameGang[0]).toMatchObject({ ids: ['a', 'b'], confidence: 'possible' })
    expect(sameGang[0].signals.map((s) => s.kind)).toEqual(['name_gang'])
    expect(findDuplicatePersons([
      person({ id: 'a', name: 'Trey Sanders', gang_id: 'g1' }),
      person({ id: 'b', name: 'T Sanders', gang_id: 'g2' }),
    ])).toHaveLength(0)
  })
  it('possible: shared vehicle and shared place links', () => {
    const people = [person({ id: 'a', name: 'A One' }), person({ id: 'b', name: 'B Two' })]
    const viaVehicle = findDuplicatePersons(people, {
      vehicles: [{ person_id: 'a', vehicle_id: 'v1' }, { person_id: 'b', vehicle_id: 'v1' }],
    })
    expect(viaVehicle[0]).toMatchObject({ ids: ['a', 'b'], confidence: 'possible' })
    expect(viaVehicle[0].signals.map((s) => s.kind)).toEqual(['vehicle'])
    const viaPlace = findDuplicatePersons(people, {
      places: [{ person_id: 'a', place_id: 'p1' }, { person_id: 'b', place_id: 'p1' }],
    })
    expect(viaPlace[0].signals.map((s) => s.kind)).toEqual(['place'])
  })
  it('excludes merged tombstones and never pairs a person with itself', () => {
    expect(findDuplicatePersons([
      person({ id: 'a', name: 'Trey Sanders' }),
      person({ id: 'b', name: 'Trey Sanders', lifecycle: 'merged', merged_into: 'a' }),
    ])).toHaveLength(0)
    expect(findDuplicatePersons([person({ id: 'a', name: 'Trey Sanders', phone: '5550100' })])).toHaveLength(0)
  })
  it('is stable: ids follow input order, strong clusters sort before possible, input untouched', () => {
    const people = [
      person({ id: 'p1', name: 'Same Name' }),
      person({ id: 'p2', name: 'Same Name' }),
      person({ id: 's1', name: 'Hard Match', dob: '1990-01-01' }),
      person({ id: 's2', name: 'Hard Match', dob: '1990-01-01' }),
    ]
    const before = JSON.stringify(people)
    const clusters = findDuplicatePersons(people)
    expect(clusters.map((c) => c.confidence)).toEqual(['strong', 'possible'])
    expect(clusters.map((c) => c.ids)).toEqual([['s1', 's2'], ['p1', 'p2']])
    expect(JSON.stringify(people)).toBe(before)
    expect(duplicatePersonIds(people)).toEqual(new Set(['p1', 'p2', 's1', 's2']))
  })
})

describe('planPersonMerge', () => {
  const survivor = person({ id: 's', name: 'Trey Sanders', dob: '1990-01-01', phone: null })
  it('surfaces only differing non-blank victim values as conflicts', () => {
    const plan = planPersonMerge(survivor, [
      person({ id: 'v1', name: 'T. Sanders', dob: '1990-01-01', phone: '5550100' }),
      person({ id: 'v2', name: 'Trey Sanders', dob: '1991-02-02', phone: '  ' }),
    ], {})
    expect(plan.survivor).toBe('s')
    expect(plan.victims).toEqual(['v1', 'v2'])
    const byField = Object.fromEntries(plan.fieldConflicts.map((c) => [c.field, c]))
    expect(byField.name.victimValues).toEqual([{ id: 'v1', value: 'T. Sanders' }])
    expect(byField.dob).toMatchObject({ survivorValue: '1990-01-01', victimValues: [{ id: 'v2', value: '1991-02-02' }] })
    // phone: survivor has none, only v1 brings a value — still surfaced (the RPC will not carry it).
    expect(byField.phone).toMatchObject({ survivorValue: '', victimValues: [{ id: 'v1', value: '5550100' }] })
    expect(byField.classification).toBeUndefined()
  })
  it('never treats the survivor as a victim, and sums repoint counts per table in RPC order', () => {
    const plan = planPersonMerge(survivor, [survivor, person({ id: 'v1' }), person({ id: 'v2' })], {
      s: { media: 99 }, // survivor counts are ignored
      v1: { media: 2, person_places: 1, watchlist: 0 },
      v2: { media: 1, legal_requests: 3 },
    })
    expect(plan.victims).toEqual(['v1', 'v2'])
    expect(plan.willRepoint).toEqual([
      { table: 'media', count: 3 },
      { table: 'legal_requests', count: 3 },
      { table: 'person_places', count: 1 },
    ])
  })
})

describe('personQualityWarnings', () => {
  const ctx = { todayISO: TODAY, nowMs: NOW, legacyPropertyCount: 0, linkedPlaceCount: 0 }
  const clean = person({
    id: 'a', name: 'Trey Sanders', dob: '1990-01-01', mugshot_url: 'https://cdn/x.png',
    reviewed_at: '2026-07-01T00:00:00Z', next_review_at: '2026-10-01T00:00:00Z',
  })
  const keysOf = (p: PersonRowLike, c: Parameters<typeof personQualityWarnings>[1] = ctx) =>
    personQualityWarnings(p, c).map((w) => w.key)
  it('a complete, freshly reviewed record has no warnings', () => {
    expect(personQualityWarnings(clean, ctx)).toEqual([])
  })
  it('flags missing/blank name, missing dob, future dob, and missing mugshot', () => {
    expect(keysOf({ ...clean, name: '  ' })).toContain('missing_name')
    expect(keysOf({ ...clean, dob: null })).toContain('missing_dob')
    expect(keysOf({ ...clean, dob: '2027-01-01' })).toContain('dob_in_future')
    expect(keysOf({ ...clean, mugshot_url: null })).toContain('missing_mugshot')
  })
  it('flags alias duplicating the name (normalized), not a distinct alias', () => {
    expect(keysOf({ ...clean, alias: 'trey-sanders' })).toContain('alias_equals_name')
    expect(keysOf({ ...clean, alias: 'Ghost' })).not.toContain('alias_equals_name')
  })
  it('flags review problems via reviewDueState — unreviewed, due, stale', () => {
    expect(keysOf({ ...clean, reviewed_at: null })).toContain('never_reviewed')
    expect(keysOf({ ...clean, next_review_at: '2026-07-01T00:00:00Z' })).toContain('review_due')
    expect(keysOf({ ...clean, reviewed_at: '2026-01-01T00:00:00Z', next_review_at: null })).toContain('stale_review')
  })
  it('flags an active BOLO without a reason — not one with a reason', () => {
    expect(keysOf({ ...clean, bolo: true })).toContain('bolo_without_reason')
    expect(keysOf({ ...clean, bolo: true, bolo_reason: 'Armed' })).not.toContain('bolo_without_reason')
  })
  it('flags legacy properties not yet linked to Places, clearing once a link exists', () => {
    expect(keysOf(clean, { ...ctx, legacyPropertyCount: 2 })).toContain('legacy_properties_unlinked')
    expect(keysOf(clean, { ...ctx, legacyPropertyCount: 2, linkedPlaceCount: 1 })).not.toContain('legacy_properties_unlinked')
  })
  it('flags a possible duplicate when the caller says so', () => {
    expect(keysOf(clean, { ...ctx, duplicateOf: true })).toEqual(['possible_duplicate'])
  })
  it('merged tombstones only warn about a missing survivor pointer', () => {
    expect(keysOf(person({ id: 'a', lifecycle: 'merged', merged_into: null }))).toEqual(['merged_without_pointer'])
    expect(keysOf(person({ id: 'a', lifecycle: 'merged', merged_into: 's', bolo: true, name: '' }))).toEqual([])
  })
  it('every warning carries a severity and a human label', () => {
    const all = personQualityWarnings(
      person({ id: 'a', name: '', bolo: true }),
      { ...ctx, duplicateOf: true, legacyPropertyCount: 1 },
    )
    for (const w of all) {
      expect(['warn', 'info']).toContain(w.severity)
      expect(w.label.length).toBeGreaterThan(4)
    }
  })
})
