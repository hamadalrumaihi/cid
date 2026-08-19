/** Unit tests for claim-level verification.
 *
 *  The rules live in the database — a field officer cannot read a verdict at
 *  all, a reviewer cannot write one except through the audited RPC, and a claim
 *  on an unsent draft cannot be judged even by an id somebody already holds.
 *  All three were probed live; 20260914120000_field_claim_verdicts.sql records
 *  the results. Pinned here is the wording and the lookup the panel depends on.
 */

import { describe, expect, it } from 'vitest'
import {
  VERDICTS, VERDICT_LABEL, VERDICT_MEANING, VERDICT_TONE,
  progressLabel, verdictFor, type ClaimProgress, type FieldVerdictRow,
} from './fieldReview'

const v = (over: Partial<FieldVerdictRow>): FieldVerdictRow => ({
  id: Math.random().toString(36), submission_id: 's1',
  person_id: null, vehicle_id: null, org_id: null, location_id: null, item_id: null,
  verdict: 'verified', note: null, decided_by: null,
  decided_at: '2026-08-19T00:00:00Z', ...over,
})

const progress = (over: Partial<ClaimProgress> = {}): ClaimProgress => ({
  claims: 0, decided: 0, verified: 0, unverified: 0, disputed: 0, rejected: 0, ...over,
})

describe('the four verdicts', () => {
  it('all carry a label, a meaning and a tone', () => {
    for (const x of VERDICTS) {
      expect(VERDICT_LABEL[x], x).toBeTruthy()
      expect(VERDICT_MEANING[x], x).toBeTruthy()
      expect(VERDICT_TONE[x], x).toBeTruthy()
    }
  })

  it('says plainly that unverified is not wrong', () => {
    // The distinction between "we could not confirm this" and "this is false"
    // is the entire reason claim-level review exists. If the wording blurs it,
    // reviewers will treat unverified as a soft rejection.
    expect(VERDICT_MEANING.unverified).toMatch(/not the same as wrong/i)
    expect(VERDICT_MEANING.disputed).toMatch(/contradicts/i)
  })

  it('does not tint unverified as a failure', () => {
    expect(VERDICT_TONE.unverified).toBe('neutral')
    expect(VERDICT_TONE.verified).toBe('good')
    expect(VERDICT_TONE.rejected).toBe('danger')
  })
})

describe('finding the verdict for a claim', () => {
  it('matches on the column for that claim kind', () => {
    const rows = [
      v({ person_id: 'p1', verdict: 'verified' }),
      v({ vehicle_id: 'v1', verdict: 'disputed' }),
    ]
    expect(verdictFor(rows, 'person', 'p1')?.verdict).toBe('verified')
    expect(verdictFor(rows, 'vehicle', 'v1')?.verdict).toBe('disputed')
  })

  it('does not confuse ids that collide across kinds', () => {
    // Claim ids are uuids so a real collision will not happen, but looking in
    // the wrong column would silently show a vehicle's verdict on a person.
    const rows = [v({ person_id: 'x', verdict: 'verified' })]
    expect(verdictFor(rows, 'vehicle', 'x')).toBeNull()
    expect(verdictFor(rows, 'org', 'x')).toBeNull()
  })

  it('returns null when nobody has decided', () => {
    expect(verdictFor([], 'person', 'p1')).toBeNull()
  })
})

describe('progress wording', () => {
  it('says when there is nothing to decide', () => {
    expect(progressLabel(progress())).toMatch(/No structured claims/)
  })

  it('counts undecided claims without implying they are rejected', () => {
    expect(progressLabel(progress({ claims: 3 }))).toBe('3 claims, none decided')
    expect(progressLabel(progress({ claims: 1 }))).toBe('1 claim, none decided')
  })

  it('reports partial progress', () => {
    expect(progressLabel(progress({ claims: 5, decided: 2, verified: 2 })))
      .toBe('2 of 5 decided · 2 verified')
  })

  it('surfaces disputes, which are the ones worth noticing', () => {
    expect(progressLabel(progress({ claims: 4, decided: 4, verified: 3, disputed: 1 })))
      .toMatch(/1 disputed/)
  })

  it('never claims a report is complete just because every claim is decided', () => {
    // Whether a report is finished is a reviewer's judgement, not arithmetic —
    // there may still be a case to link or an officer to thank.
    const label = progressLabel(progress({ claims: 2, decided: 2, verified: 2 }))
    expect(label).toBe('2 of 2 decided · 2 verified')
    expect(label.toLowerCase()).not.toContain('complete')
    expect(label.toLowerCase()).not.toContain('done')
  })
})
