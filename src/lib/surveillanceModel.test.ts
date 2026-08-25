/** Pins for the pure surveillance model — the client mirrors of the
 *  20260812120000 server rules and the §derived pattern analysis. The core
 *  contract under test: patterns derive from VERIFIED observations only
 *  (unless explicitly opted in) and a repeated sighting needs ≥2 hits. */
import { describe, expect, it } from 'vitest'
import {
  canAuthorizeSurveillance, canManageTarget, effectiveStatus, isTargetEnded,
  observationPatterns, targetStatusTint,
  type PatternEntity, type PatternObservation, type SurvViewer,
} from './surveillanceModel'

const NOW = Date.parse('2026-08-10T12:00:00.000Z')

function obs(over: Partial<PatternObservation> & { id: string }): PatternObservation {
  return {
    observed_at: '2026-08-01T10:00:00.000Z', verification_status: 'verified',
    place_id: null, location_text: null, person_id: null, vehicle_id: null,
    plate_snapshot: null, ...over,
  }
}

const ent = (observation_id: string, kind: string, ref_id: string): PatternEntity =>
  ({ observation_id, kind, ref_id })

/* ── observationPatterns ─────────────────────────────────────────────────── */

describe('observationPatterns — verified-only filtering', () => {
  it('unverified rows are excluded from every derivation by default', () => {
    const rows = [
      obs({ id: 'o1', vehicle_id: 'v1' }),
      obs({ id: 'o2', vehicle_id: 'v1', verification_status: 'unverified' }),
      obs({ id: 'o3', vehicle_id: 'v1', verification_status: 'rejected' }),
    ]
    const p = observationPatterns(rows, [], NOW)
    expect(p.consideredCount).toBe(1)
    expect(p.repeatedVehicles).toHaveLength(0) // one verified hit is no pattern
  })

  it('entity links on excluded observations contribute nothing', () => {
    const rows = [
      obs({ id: 'o1' }),
      obs({ id: 'o2', verification_status: 'unverified' }),
    ]
    const p = observationPatterns(rows, [ent('o1', 'person', 'p1'), ent('o2', 'person', 'p1')], NOW)
    expect(p.repeatedPersons).toHaveLength(0)
  })

  it('includeUnverified opts the raw feed in — clearly a caller decision', () => {
    const rows = [
      obs({ id: 'o1', vehicle_id: 'v1' }),
      obs({ id: 'o2', vehicle_id: 'v1', verification_status: 'unverified' }),
    ]
    const p = observationPatterns(rows, [], NOW, { includeUnverified: true })
    expect(p.consideredCount).toBe(2)
    expect(p.repeatedVehicles).toEqual([{ vehicleId: 'v1', plate: null, count: 2 }])
  })
})

describe('observationPatterns — repeated locations', () => {
  it('groups by place_id with count and first/last seen', () => {
    const rows = [
      obs({ id: 'o1', place_id: 'pl1', observed_at: '2026-08-01T10:00:00.000Z' }),
      obs({ id: 'o2', place_id: 'pl1', observed_at: '2026-08-03T22:00:00.000Z' }),
      obs({ id: 'o3', place_id: 'pl2', observed_at: '2026-08-02T09:00:00.000Z' }),
    ]
    const p = observationPatterns(rows, [], NOW)
    expect(p.repeatedLocations).toEqual([{
      placeId: 'pl1', locationText: null, count: 2,
      firstSeen: '2026-08-01T10:00:00.000Z', lastSeen: '2026-08-03T22:00:00.000Z',
    }])
  })

  it('free-text locations normalize (case/whitespace) but display the original text', () => {
    const rows = [
      obs({ id: 'o1', location_text: 'Vespucci Docks' }),
      obs({ id: 'o2', location_text: '  vespucci docks ' }),
    ]
    const p = observationPatterns(rows, [], NOW)
    expect(p.repeatedLocations).toHaveLength(1)
    expect(p.repeatedLocations[0]).toMatchObject({ placeId: null, locationText: 'Vespucci Docks', count: 2 })
  })
})

describe('observationPatterns — repeated vehicles & persons', () => {
  it('plate snapshots normalize to uppercase; a resolved vehicle_id wins over its plate', () => {
    const rows = [
      obs({ id: 'o1', plate_snapshot: 'sa 123' }),
      obs({ id: 'o2', plate_snapshot: 'SA 123' }),
      obs({ id: 'o3', vehicle_id: 'v9', plate_snapshot: 'ZZ 999' }), // FK wins — plate not double-keyed
    ]
    const p = observationPatterns(rows, [], NOW)
    expect(p.repeatedVehicles).toEqual([{ vehicleId: null, plate: 'SA 123', count: 2 }])
  })

  it('a direct vehicle FK plus an entity link to the SAME vehicle counts one sighting', () => {
    const rows = [obs({ id: 'o1', vehicle_id: 'v1' }), obs({ id: 'o2', vehicle_id: 'v1' })]
    const p = observationPatterns(rows, [ent('o1', 'vehicle', 'v1')], NOW)
    expect(p.repeatedVehicles).toEqual([{ vehicleId: 'v1', plate: null, count: 2 }])
  })

  it('persons combine the direct FK and entity links, one hit per observation', () => {
    const rows = [
      obs({ id: 'o1', person_id: 'p1' }),
      obs({ id: 'o2' }),
      obs({ id: 'o3', person_id: 'p2' }),
    ]
    const p = observationPatterns(rows, [ent('o1', 'person', 'p1'), ent('o2', 'person', 'p1')], NOW)
    expect(p.repeatedPersons).toEqual([{ personId: 'p1', count: 2 }])
  })
})

describe('observationPatterns — co-occurrence, histogram, span', () => {
  it('pairs seen together ≥2 times surface; one-off pairings stay quiet', () => {
    const rows = [obs({ id: 'o1' }), obs({ id: 'o2' }), obs({ id: 'o3' })]
    const p = observationPatterns(rows, [
      ent('o1', 'person', 'p1'), ent('o1', 'person', 'p2'),
      ent('o2', 'person', 'p1'), ent('o2', 'person', 'p2'),
      ent('o3', 'person', 'p1'), ent('o3', 'person', 'p3'), // p1+p3 only once
    ], NOW)
    expect(p.coOccurrence).toEqual([
      { aKind: 'person', aRefId: 'p1', bKind: 'person', bRefId: 'p2', count: 2 },
    ])
  })

  it('direct person/vehicle/place refs join the pair pool with linked entities', () => {
    const rows = [
      obs({ id: 'o1', person_id: 'p1', place_id: 'pl1' }),
      obs({ id: 'o2', person_id: 'p1', place_id: 'pl1' }),
    ]
    const p = observationPatterns(rows, [], NOW)
    expect(p.coOccurrence).toEqual([
      { aKind: 'person', aRefId: 'p1', bKind: 'place', bRefId: 'pl1', count: 2 },
    ])
  })

  it('hourHistogram buckets by UTC hour (deterministic, no locale)', () => {
    const rows = [
      obs({ id: 'o1', observed_at: '2026-08-01T02:15:00.000Z' }),
      obs({ id: 'o2', observed_at: '2026-08-02T02:45:00.000Z' }),
      obs({ id: 'o3', observed_at: '2026-08-02T23:05:00.000Z' }),
    ]
    const p = observationPatterns(rows, [], NOW)
    expect(p.hourHistogram[2]).toBe(2)
    expect(p.hourHistogram[23]).toBe(1)
    expect(p.hourHistogram.reduce((a, b) => a + b, 0)).toBe(3)
  })

  it('firstSeen/lastSeen span the considered rows; daysSinceLast uses the injected clock', () => {
    const rows = [
      obs({ id: 'o1', observed_at: '2026-08-01T10:00:00.000Z' }),
      obs({ id: 'o2', observed_at: '2026-08-06T10:00:00.000Z' }),
    ]
    const p = observationPatterns(rows, [], NOW)
    expect(p.firstSeen).toBe('2026-08-01T10:00:00.000Z')
    expect(p.lastSeen).toBe('2026-08-06T10:00:00.000Z')
    expect(p.daysSinceLast).toBe(4)
  })

  it('empty input yields an empty, well-formed shape', () => {
    const p = observationPatterns([], [], NOW)
    expect(p).toMatchObject({
      consideredCount: 0, repeatedLocations: [], repeatedVehicles: [],
      repeatedPersons: [], coOccurrence: [], firstSeen: null, lastSeen: null,
      daysSinceLast: null,
    })
    expect(p.hourHistogram).toHaveLength(24)
  })
})

/* ── authority mirrors ───────────────────────────────────────────────────── */

const viewer = (over: Partial<SurvViewer> = {}): SurvViewer =>
  ({ userId: 'me', role: 'detective', division: 'major_crimes', isOwner: false, ...over })

describe('canAuthorizeSurveillance', () => {
  it('deputy director / director / owner authorize anywhere', () => {
    expect(canAuthorizeSurveillance(viewer({ role: 'deputy_director', division: null }), 'street_crimes')).toBe(true)
    expect(canAuthorizeSurveillance(viewer({ role: 'director', division: null }), null)).toBe(true)
    expect(canAuthorizeSurveillance(viewer({ isOwner: true }), 'street_crimes')).toBe(true)
  })

  it('a bureau lead authorizes only their own division or JTF cases', () => {
    const lead = viewer({ role: 'bureau_lead', division: 'major_crimes' })
    expect(canAuthorizeSurveillance(lead, 'major_crimes')).toBe(true)
    expect(canAuthorizeSurveillance(lead, 'JTF')).toBe(true)
    expect(canAuthorizeSurveillance(lead, 'street_crimes')).toBe(false)
    expect(canAuthorizeSurveillance(lead, null)).toBe(false)
  })

  it('detectives never authorize', () => {
    expect(canAuthorizeSurveillance(viewer(), 'major_crimes')).toBe(false)
  })
})

describe('canManageTarget / lifecycle helpers', () => {
  it('the requester or command manages a target; others do not', () => {
    expect(canManageTarget(viewer(), { requested_by: 'me' })).toBe(true)
    expect(canManageTarget(viewer(), { requested_by: 'other' })).toBe(false)
    expect(canManageTarget(viewer({ role: 'bureau_lead' }), { requested_by: 'other' })).toBe(true)
    expect(canManageTarget(viewer({ isOwner: true }), { requested_by: 'other' })).toBe(true)
  })

  it('isTargetEnded matches the concluded statuses only', () => {
    for (const s of ['completed', 'denied', 'expired', 'cancelled']) expect(isTargetEnded(s)).toBe(true)
    for (const s of ['draft', 'pending_approval', 'authorized', 'active', 'suspended']) expect(isTargetEnded(s)).toBe(false)
  })

  it('effectiveStatus shows expired for running targets past their window', () => {
    const past = '2026-08-01T00:00:00.000Z'
    expect(effectiveStatus({ status: 'active', expires_at: past }, NOW)).toBe('expired')
    expect(effectiveStatus({ status: 'authorized', expires_at: past }, NOW)).toBe('expired')
    expect(effectiveStatus({ status: 'suspended', expires_at: past }, NOW)).toBe('expired')
    // Concluded / future-window rows render their real status.
    expect(effectiveStatus({ status: 'completed', expires_at: past }, NOW)).toBe('completed')
    expect(effectiveStatus({ status: 'active', expires_at: '2026-09-01T00:00:00.000Z' }, NOW)).toBe('active')
    expect(effectiveStatus({ status: 'active', expires_at: null }, NOW)).toBe('active')
  })

  it('every status renders a tint class (unknown falls back muted)', () => {
    expect(targetStatusTint('active')).toContain('emerald')
    expect(targetStatusTint('pending_approval')).toContain('amber')
    expect(targetStatusTint('authorized')).toContain('blue')
    expect(targetStatusTint('denied')).toContain('rose')
    expect(targetStatusTint('completed')).toContain('slate')
    expect(targetStatusTint('nonsense')).toContain('slate')
  })
})
