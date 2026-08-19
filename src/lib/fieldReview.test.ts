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
  ARCHIVE_REASONS, DELETED_FILTER, OPEN_STATUSES, QUEUE_FILTERS, QUEUE_LABEL,
  assignmentLine, awaitingReviewer, countsSummary, isOpen, matchesFilter,
  repeatLine, reviewNext, reviewPrompt,
} from './fieldReview'
import type {
  FieldAssignmentRow, FieldMessageRow, RepeatSignal, SubmissionCounts,
} from './fieldReview'

const sub = (over: Partial<FieldSubmissionRow> = {}): FieldSubmissionRow => ({
  id: 's1', submission_no: 'FI-2026-0001', officer_id: 'u1', snap_agency: 'SAHP',
  snap_callsign: '924', snap_rank: null, snap_unit: null,
  snap_officer_name: 'Tom Wood',
  status: 'new', jurisdiction: 'city', summary: 'x', details: null,
  observed_at: null, observed_to: null, observed_precision: 'unknown',
  mdt_reference: null, submitted_at: '2026-08-19T00:00:00Z', assigned_to: null,
  assigned_at: null,
  siu_state: null, siu_category: null, siu_reason: null,
  siu_referred_by: null, siu_referred_at: null,
  siu_assigned_to: null, siu_assigned_at: null, siu_sensitive: false,
  siu_case_id: null,
  source_type: 'patrol', source_codename: null, urgency: null, reliability: null, created_by: null,
  archived_at: null, archived_by: null, archive_reason: null,
  deleted_at: null, deleted_by: null, delete_reason: null,
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

  it('starts a new record at reviewing, reviewed, actionable or archived', () => {
    expect(reviewNext('new')).toEqual(['reviewing', 'reviewed', 'actionable', 'archived'])
  })

  it('never routes a record backwards to new', () => {
    // 'new' means "sent, and nobody has looked". Returning a record there
    // would erase the fact that somebody did.
    for (const s of FIELD_STATUSES) {
      expect(reviewNext(s), s).not.toContain('new')
    }
  })

  it('never offers draft as an outcome', () => {
    // A reviewer cannot push a report back into the officer's editable window;
    // that would let the account of what happened be rewritten after review.
    for (const s of FIELD_STATUSES) {
      expect(reviewNext(s), s).not.toContain('draft')
    }
  })

  it('reopens an archived record to reviewing and nowhere else', () => {
    // Archiving is a judgement, and judgements are sometimes wrong. Restoring
    // means somebody is looking again -- not that the old decision returns
    // with it.
    expect(reviewNext('archived')).toEqual(['reviewing'])
  })

  it('keeps a reviewed record reopenable, because a second report can change it', () => {
    // Something read a week ago matters the moment another record names the
    // same person, so 'reviewed' is not a dead end.
    expect(reviewNext('reviewed')).toContain('reviewing')
    expect(reviewNext('actionable')).toContain('reviewing')
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
    expect(OPEN_STATUSES).toEqual(['new', 'reviewing', 'needs_info'])
    expect(isOpen('new')).toBe(true)
    expect(isOpen('reviewed')).toBe(false)
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

  it('is null once the record is settled', () => {
    for (const s of ['reviewed', 'archived'] as const) {
      expect(reviewPrompt(sub({ status: s })), s).toBeNull()
    }
  })

  it('still says something for an actionable record, which is live work', () => {
    // 'actionable' is not a resting state: somebody decided this is worth
    // acting on, and the queue should keep saying so until it is.
    expect(reviewPrompt(sub({ status: 'actionable' }))).toBe('Being acted on')
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
    expect(matchesFilter(sub({ status: 'new', assigned_to: null }), 'unclaimed', ME)).toBe(true)
    expect(matchesFilter(sub({ status: 'archived', assigned_to: null }), 'unclaimed', ME)).toBe(false)
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

  it('treats a decided record as processed, not as open work', () => {
    // These are decisions that were made, not decisions still owed.
    expect(matchesFilter(sub({ status: 'archived' }), 'processed', ME)).toBe(true)
    expect(matchesFilter(sub({ status: 'reviewed' }), 'processed', ME)).toBe(true)
    expect(matchesFilter(sub({ status: 'actionable' }), 'processed', ME)).toBe(true)
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

describe('archive and delete are different things', () => {
  const ME = 'd1'

  it('offers reasons worth having a word for', () => {
    // "Archived" tells the next person nothing; "unable to corroborate" tells
    // them whether it is worth trying again.
    expect(ARCHIVE_REASONS.length).toBeGreaterThan(3)
    expect(ARCHIVE_REASONS).toContain('Unable to corroborate')
    expect(ARCHIVE_REASONS).toContain('Duplicate of another record')
  })

  it('keeps an archived record in its own queue, out of the working ones', () => {
    const r = sub({ status: 'archived', assigned_to: null })
    expect(matchesFilter(r, 'archived', ME)).toBe(true)
    expect(matchesFilter(r, 'unclaimed', ME)).toBe(false)
    // ...but it is still there under All, because archived is not gone.
    expect(matchesFilter(r, 'all', ME)).toBe(true)
  })

  it('keeps a deleted record out of every queue except Deleted', () => {
    // The Owner is the only reader who sees these at all, and one turning up
    // in a working queue is one somebody would work.
    const r = sub({ status: 'new', assigned_to: null, deleted_at: '2026-08-19T00:00:00Z' })
    expect(matchesFilter(r, DELETED_FILTER, ME)).toBe(true)
    for (const f of QUEUE_FILTERS) {
      expect(matchesFilter(r, f, ME), f).toBe(false)
    }
  })

  it('keeps a live record out of the Deleted list', () => {
    expect(matchesFilter(sub({ status: 'new' }), DELETED_FILTER, ME)).toBe(false)
  })

  it('labels every queue including the archive', () => {
    for (const f of QUEUE_FILTERS) expect(QUEUE_LABEL[f], f).toBeTruthy()
  })
})

describe('the repeat signal', () => {
  const rep = (over: Partial<RepeatSignal> = {}): RepeatSignal => ({
    kind: 'person', label: 'Marisol Rodriguez', basis: 'named',
    others: 2, records: ['FI-2026-0003', 'FI-2026-0009'], ...over,
  })

  it('says how many others, because the count is the whole signal', () => {
    expect(repeatLine(rep())).toBe('Marisol Rodriguez — also named in 2 other records')
    expect(repeatLine(rep({ others: 1 }))).toBe('Marisol Rodriguez — also named in 1 other record')
  })

  it('distinguishes a shared name from a reviewer-confirmed match', () => {
    // Two people can share a name. Two records matched to the same registry
    // entry cannot -- a human already decided they were the same, so it reads
    // as a stronger claim rather than the same sentence.
    expect(repeatLine(rep({ basis: 'linked' })))
      .toBe('Marisol Rodriguez — matched to the same registry record in 2 other records')
  })
})
