/** Unit tests for entity matching and publication, client side.
 *
 *  The normalizers themselves are SQL (`private.norm_plate`, `private.norm_org`)
 *  and were probed against the live gang roster — the results are recorded in
 *  20260915120000_field_entity_matching.sql, including the dotted-abbreviation
 *  bug the first draft had. What is pinned here is the client's handling of a
 *  match result, which decides what a reviewer is shown and offered.
 */

import { describe, expect, it } from 'vitest'
import { linkFor, type FieldClaimLinkRow } from './fieldReview'

const link = (over: Partial<FieldClaimLinkRow>): FieldClaimLinkRow => ({
  id: Math.random().toString(36), submission_id: 's1',
  claim_person_id: null, claim_vehicle_id: null, claim_org_id: null,
  claim_location_id: null,
  person_id: null, vehicle_id: null, gang_id: null, place_id: null,
  linked_by: null, linked_at: '2026-08-19T00:00:00Z', ...over,
})

describe('finding whether a claim is already matched', () => {
  it('looks in the column for that claim kind', () => {
    const links = [
      link({ claim_vehicle_id: 'cv1', vehicle_id: 'v1' }),
      link({ claim_org_id: 'co1', gang_id: 'g1' }),
    ]
    expect(linkFor(links, 'vehicle', 'cv1')?.vehicle_id).toBe('v1')
    expect(linkFor(links, 'org', 'co1')?.gang_id).toBe('g1')
  })

  it('does not read one claim kind out of another kind column', () => {
    const links = [link({ claim_person_id: 'x', person_id: 'p1' })]
    expect(linkFor(links, 'vehicle', 'x')).toBeNull()
    expect(linkFor(links, 'org', 'x')).toBeNull()
    expect(linkFor(links, 'location', 'x')).toBeNull()
  })

  it('returns null for items, which are not matchable at all', () => {
    // A seizure is an event, not a standing record — there is no table of
    // items for it to be a duplicate of, and the RPC says so too.
    const links = [link({ claim_person_id: 'x', person_id: 'p1' })]
    expect(linkFor(links, 'item', 'x')).toBeNull()
  })

  it('returns null when nothing has been matched', () => {
    expect(linkFor([], 'person', 'p1')).toBeNull()
  })
})
