/** Unit tests for the review mirror.
 *
 *  The rules are in the database — the transition table, who may call which
 *  RPC, and above all the fact that a field officer cannot read
 *  `field_submission_reviews` at all. Those were probed live and the results are
 *  recorded in 20260913120000_field_review.sql. What is pinned here is the
 *  client's copy of the lane, which drives which outcomes a reviewer is offered.
 */

import { describe, expect, it } from 'vitest'
import { FIELD_STATUSES, type FieldSubmissionRow } from './fieldSubmissions'
import {
  OPEN_STATUSES, QUEUE_FILTERS, QUEUE_LABEL, assignmentLine, awaitingReviewer,
  countsSummary, isOpen, matchesFilter, reviewNext, reviewPrompt,
} from './fieldReview'
import type { FieldAssignmentRow, FieldMessageRow, SubmissionCounts } from './fieldReview'

const sub = (over: Partial<FieldSubmissionRow> = {}): FieldSubmissionRow => ({
  id: 's1', submission_no: 'FI-2026-0001', officer_id: 'u1', snap_agency: 'SAHP',
  snap_callsign: '924', snap_rank: null, snap_unit: null,
  status: 'submitted', jurisdiction: 'city', summary: 'x', details: null,
  observed_at: null, observed_to: null, observed_precision: 'unknown',
  mdt_reference: null, submitted_at: '2026-08-19T00:00:00Z', assigned_to: null,
  assigned_at: null,
  created_at: '2026-08-19T00:00:00Z', updated_at: '2026-08-19T00:00:00Z',
  ...over,
})

const msg = (from_reviewer: boolean): FieldMessageRow => ({
  id: Math.random().toString(36), submission_id: 's1', author_id: null,
  from_reviewer, body: 'x', created_at: '2026-08-19T00:00:00Z',
})

describe('the review lane', () => {
  it('offers nothing out of a draft — a draft is not in the queue', () => {
    // RLS does not even return drafts to a reviewer; this makes the client
    // agree rather than rendering outcomes that would be refused.
    expect(reviewNext('draft')).toEqual([])
  })

  it('starts a submitted report at reviewing, archived or rejected', () => {
    expect(reviewNext('submitted')).toEqual(['reviewing', 'archived', 'rejected'])
  })

  it('never routes a report backwards to submitted', () => {
    // 'submitted' means "the officer has sent it and nobody has looked".
    // Returning a report there would erase the fact that it was reviewed.
    for (const s of FIELD_STATUSES) {
      expect(reviewNext(s), s).not.toContain('submitted')
    }
  })

  it('never offers draft as an outcome', () => {
    // A reviewer cannot push a report back into the officer's editable window;
    // that would let the account of what happened be rewritten after review.
    for (const s of FIELD_STATUSES) {
      expect(reviewNext(s), s).not.toContain('draft')
    }
  })

  it('lets a wrong rejection be undone', () => {
    // Rejecting is a judgement, and judgements are sometimes wrong. Both
    // rejected and archived reopen to reviewing.
    expect(reviewNext('rejected')).toContain('reviewing')
    expect(reviewNext('archived')).toContain('reviewing')
  })

  it('narrows as a report settles, ending at archived', () => {
    expect(reviewNext('intel_added')).not.toContain('rejected')
    expect(reviewNext('linked_case')).toEqual(['archived'])
  })

  it('returns an empty list for a status it does not know', () => {
    expect(reviewNext('nonsense')).toEqual([])
  })

  it('every offered outcome is a real status', () => {
    for (const s of FIELD_STATUSES) {
      for (const to of reviewNext(s)) {
        expect(FIELD_STATUSES, `${s} -> ${to}`).toContain(to)
      }
    }
  })
})

describe('the open queue', () => {
  it('is the statuses that still want a decision', () => {
    expect(OPEN_STATUSES).toEqual(['submitted', 'reviewing', 'needs_info', 'partially_reviewed'])
    expect(isOpen('submitted')).toBe(true)
    expect(isOpen('intel_added')).toBe(false)
    expect(isOpen('archived')).toBe(false)
  })

  it('does not count drafts, which reviewers cannot see anyway', () => {
    expect(isOpen('draft')).toBe(false)
  })
})

describe('what the reviewer is being asked to do', () => {
  it('distinguishes unassigned review from assigned', () => {
    expect(reviewPrompt(sub({ status: 'reviewing' }))).toMatch(/unassigned/)
    expect(reviewPrompt(sub({ status: 'reviewing', assigned_to: 'd1' }))).toBe('In review')
  })

  it('says when the ball is with the officer', () => {
    expect(reviewPrompt(sub({ status: 'needs_info' }))).toMatch(/Waiting on the officer/)
  })

  it('is null once the report is settled', () => {
    for (const s of ['intel_added', 'linked_case', 'archived', 'rejected'] as const) {
      expect(reviewPrompt(sub({ status: s })), s).toBeNull()
    }
  })
})

describe('spotting a reply that is waiting', () => {
  it('is true when the officer spoke last', () => {
    // Answering deliberately does NOT change the status, so the thread is the
    // only signal a reviewer gets.
    expect(awaitingReviewer([msg(true), msg(false)])).toBe(true)
  })

  it('is false when the reviewer spoke last, or nobody has', () => {
    expect(awaitingReviewer([msg(false), msg(true)])).toBe(false)
    expect(awaitingReviewer([])).toBe(false)
  })
})

const counts = (over: Partial<SubmissionCounts> = {}): SubmissionCounts => ({
  submission_id: 's1', persons: 0, vehicles: 0, orgs: 0,
  locations: 0, items: 0, evidence: 0, ...over,
})

const asg = (over: Partial<FieldAssignmentRow> = {}): FieldAssignmentRow => ({
  id: 'a1', submission_id: 's1', action: 'claimed', actor_id: 'd1',
  from_user: null, to_user: 'd1', reason: null,
  created_at: '2026-08-19T00:00:00Z', ...over,
})

describe('the queues', () => {
  const ME = 'd1'

  it('gives every filter a label', () => {
    for (const f of QUEUE_FILTERS) expect(QUEUE_LABEL[f], f).toBeTruthy()
  })

  it('counts an unheld report as unclaimed only while it still wants a decision', () => {
    // A processed report with nobody on it is not work waiting to be taken; it
    // is finished. Listing it under Unclaimed would make the queue a liar.
    expect(matchesFilter(sub({ status: 'submitted', assigned_to: null }), 'unclaimed', ME)).toBe(true)
    expect(matchesFilter(sub({ status: 'archived', assigned_to: null }), 'unclaimed', ME)).toBe(false)
    expect(matchesFilter(sub({ status: 'rejected', assigned_to: null }), 'unclaimed', ME)).toBe(false)
  })

  it('never puts a report in both Unclaimed and Assigned', () => {
    for (const s of FIELD_STATUSES) {
      for (const held of [null, ME, 'd2']) {
        const r = sub({ status: s, assigned_to: held })
        expect(
          matchesFilter(r, 'unclaimed', ME) && matchesFilter(r, 'assigned', ME),
          `${s}/${held}`,
        ).toBe(false)
      }
    }
  })

  it('is Mine only when it is actually mine', () => {
    expect(matchesFilter(sub({ assigned_to: ME }), 'mine', ME)).toBe(true)
    expect(matchesFilter(sub({ assigned_to: 'd2' }), 'mine', ME)).toBe(false)
    expect(matchesFilter(sub({ assigned_to: null }), 'mine', ME)).toBe(false)
    // Signed out / unknown: nothing is mine, rather than everything.
    expect(matchesFilter(sub({ assigned_to: null }), 'mine', null)).toBe(false)
  })

  it('splits by jurisdiction without inventing one', () => {
    expect(matchesFilter(sub({ jurisdiction: 'city' }), 'city', ME)).toBe(true)
    expect(matchesFilter(sub({ jurisdiction: 'blaine' }), 'city', ME)).toBe(false)
    expect(matchesFilter(sub({ jurisdiction: null }), 'city', ME)).toBe(false)
    expect(matchesFilter(sub({ jurisdiction: null }), 'blaine', ME)).toBe(false)
  })

  it('shows everything under All', () => {
    for (const s of FIELD_STATUSES) {
      expect(matchesFilter(sub({ status: s }), 'all', ME), s).toBe(true)
    }
  })

  it('treats rejected as processed, not as open work', () => {
    // Rejected is a decision that was made, not a decision still owed.
    expect(matchesFilter(sub({ status: 'rejected' }), 'processed', ME)).toBe(true)
    expect(matchesFilter(sub({ status: 'intel_added' }), 'processed', ME)).toBe(true)
    expect(matchesFilter(sub({ status: 'needs_info' }), 'processed', ME)).toBe(false)
  })
})

describe('what a report card says it contains', () => {
  it('lists only the parts that are there', () => {
    expect(countsSummary(counts({ persons: 2, vehicles: 1, evidence: 3 })))
      .toBe('2 people · 1 vehicle · 3 evidence items')
  })

  it('says nothing at all for an empty report, rather than six zeroes', () => {
    expect(countsSummary(counts())).toBe('')
    expect(countsSummary(undefined)).toBe('')
  })

  it('gets the singular right', () => {
    expect(countsSummary(counts({ persons: 1 }))).toBe('1 person')
    expect(countsSummary(counts({ items: 1 }))).toBe('1 item')
  })
})

describe('reading the assignment history', () => {
  const name = (id: string | null) => (id === 'd1' ? 'Reyes' : id === 'd2' ? 'Okafor' : 'Someone')

  it('says who did what, in words', () => {
    expect(assignmentLine(asg(), name)).toBe('Reyes claimed it')
    expect(assignmentLine(asg({ action: 'released', from_user: 'd1', to_user: null }), name))
      .toBe('Reyes released it')
    expect(assignmentLine(asg({ action: 'assigned', actor_id: 'd2', to_user: 'd1' }), name))
      .toBe('Okafor assigned it to Reyes')
    expect(assignmentLine(asg({ action: 'reassigned', actor_id: 'd2', from_user: 'd1', to_user: 'd2' }), name))
      .toBe('Okafor moved it from Reyes to Okafor')
  })

  it('falls back to the raw action rather than dropping a line', () => {
    // The database could gain an action before this file does. A history with a
    // silent gap in it is worse than one with an unfamiliar word in it.
    expect(assignmentLine(asg({ action: 'siu_assigned' }), name)).toBe('siu_assigned')
  })
})
