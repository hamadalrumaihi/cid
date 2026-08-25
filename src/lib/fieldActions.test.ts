/** Unit tests for the intelligence-actions mirror.
 *
 *  The rules that matter are in the database and were probed live against real
 *  roles — provenance cannot be unlinked, a direct insert into the link table is
 *  refused, an observation needs the record on the case first, and a record
 *  cannot call itself confidential without a registered source. Those results
 *  are recorded in 20260924120000_intelligence_actions.sql.
 *
 *  What is pinned here is the part the client actually decides: how a link
 *  reads back to a person, which links are live, and the fact that the
 *  confidence vocabulary offered for an observation drawn from a report leaves
 *  out 'confirmed' — a report OF something is not a confirmation of it.
 */

import { describe, expect, it } from 'vitest'
import {
  CASE_BUREAUS, OBSERVATION_CONFIDENCE, isProvenance, linkLine, liveLinks,
  type FieldCaseLinkRow,
} from './fieldActions'

const link = (over: Partial<FieldCaseLinkRow> = {}): FieldCaseLinkRow => ({
  id: 'l1', submission_id: 's1', case_id: 'c1', relation: 'linked',
  submission_no: 'FI-2026-0001', note: null,
  linked_by: 'u1', linked_at: '2026-08-19T00:00:00Z',
  unlinked_by: null, unlinked_at: null, unlink_reason: null,
  ...over,
})

describe('case links', () => {
  it('separates provenance from an ordinary link', () => {
    expect(isProvenance(link({ relation: 'originated' }))).toBe(true)
    expect(isProvenance(link())).toBe(false)
  })

  it('keeps unlinked rows out of the live set but not out of the history', () => {
    const rows = [
      link({ id: 'a' }),
      link({ id: 'b', unlinked_at: '2026-08-20T00:00:00Z', unlink_reason: 'wrong Rodriguez' }),
    ]
    expect(liveLinks(rows).map((l) => l.id)).toEqual(['a'])
    // The removed row is still there to read — that is the point of stamping
    // rather than deleting.
    expect(rows).toHaveLength(2)
  })

  it('says why a link was removed, not just that it was', () => {
    expect(linkLine(link({ unlinked_at: '2026-08-20T00:00:00Z', unlink_reason: 'wrong Rodriguez' })))
      .toBe('Unlinked — wrong Rodriguez')
    // A removed link with no recorded reason still reads as removed rather than
    // falling back to the note it carried while it was live.
    expect(linkLine(link({ unlinked_at: '2026-08-20T00:00:00Z', note: 'same street' })))
      .toBe('Unlinked')
  })

  it('states provenance in full rather than as a label', () => {
    expect(linkLine(link({ relation: 'originated' })))
      .toBe('This case was opened from this record')
  })

  it('prefers the linker note to a generic line', () => {
    expect(linkLine(link({ note: 'same street, same week' }))).toBe('same street, same week')
    expect(linkLine(link())).toBe('Linked to this case')
  })
})

describe('vocabularies', () => {
  it('does not offer "confirmed" for an observation drawn from a report', () => {
    // A report of something is not a confirmation of it. The database applies
    // the same rule, and the browser insert path has always downgraded it.
    expect(OBSERVATION_CONFIDENCE).not.toContain('confirmed')
    expect(OBSERVATION_CONFIDENCE).toEqual(
      ['probable', 'possible', 'unverified', 'disproven'])
  })

  it('offers exactly the bureaus a case can belong to', () => {
    expect([...CASE_BUREAUS]).toEqual(['major_crimes', 'street_crimes', 'JTF'])
  })
})
