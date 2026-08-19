/** Unit tests for the Field Intelligence submission mirror.
 *
 *  The rules that matter — who may edit what, who stamps the reporting officer,
 *  when an FI number is issued — are enforced in the database and were probed
 *  there; 20260911120000_field_submissions.sql records the results. What is
 *  pinned here is the arithmetic and the wording the officer actually sees.
 */

import { describe, expect, it } from 'vitest'
import {
  FIELD_STATUSES, fieldStatusLabel, fieldStatusMeaning, isEditableByOfficer,
  normalizedGrams, submissionRef, submitProblem, weightProblem,
} from './fieldSubmissions'
import type { FieldSubmissionRow } from './fieldSubmissions'

const sub = (over: Partial<FieldSubmissionRow> = {}): FieldSubmissionRow => ({
  id: 's1', submission_no: null, officer_id: 'u1', snap_agency: 'SAHP',
  snap_callsign: '924', snap_rank: null, snap_unit: null,
  status: 'draft', route: 'unsure', summary: null, details: null,
  observed_at: null, observed_to: null, observed_precision: 'unknown',
  mdt_reference: null, submitted_at: null, assigned_to: null,
  created_at: '2026-08-19T00:00:00Z', updated_at: '2026-08-19T00:00:00Z',
  ...over,
})

describe('weight normalization', () => {
  it('matches the generated column, including the design example', () => {
    // The spec's own worked example: 2.4 lb -> 1088.62 g.
    expect(normalizedGrams(2.4, 'lb')).toBeCloseTo(1088.62, 2)
    expect(normalizedGrams(1, 'kg')).toBe(1000)
    expect(normalizedGrams(1, 'oz')).toBeCloseTo(28.3495, 4)
    expect(normalizedGrams(500, 'g')).toBe(500)
  })

  it('returns null rather than guessing when the unit is missing or unknown', () => {
    expect(normalizedGrams(2.4, null)).toBeNull()
    expect(normalizedGrams(2.4, 'stone')).toBeNull()
    expect(normalizedGrams(null, 'lb')).toBeNull()
  })
})

describe('a weight is a number AND a unit', () => {
  it('accepts both, or neither', () => {
    expect(weightProblem(2.4, 'lb')).toBeNull()
    expect(weightProblem(null, null)).toBeNull()
  })

  it('refuses half a measurement', () => {
    // The check constraint refuses these too; catching them here means the
    // officer reads a sentence instead of a constraint name.
    expect(weightProblem(2.4, null)).toMatch(/unit/)
    expect(weightProblem(null, 'lb')).toMatch(/weight, or clear the unit/)
  })

  it('refuses a negative weight', () => {
    expect(weightProblem(-1, 'g')).toMatch(/negative/)
  })
})

describe('what a report needs before it can be sent', () => {
  it('requires a summary, because a report that says nothing is not a report', () => {
    expect(submitProblem(sub())).toMatch(/Say what happened/)
    expect(submitProblem(sub({ summary: '   ' }))).toMatch(/Say what happened/)
    expect(submitProblem(sub({ summary: 'Saw a van' }))).toBeNull()
  })

  it('requires both ends of a time range', () => {
    const base = { summary: 'x', observed_precision: 'range' as const }
    expect(submitProblem({ ...base, observed_at: '2026-08-19T01:00:00Z', observed_to: null }))
      .toMatch(/both a start and an end/)
    expect(submitProblem({ ...base, observed_at: null, observed_to: '2026-08-19T02:00:00Z' }))
      .toMatch(/both a start and an end/)
  })

  it('refuses a range that ends before it starts', () => {
    expect(submitProblem({
      summary: 'x', observed_precision: 'range',
      observed_at: '2026-08-19T03:00:00Z', observed_to: '2026-08-19T01:00:00Z',
    })).toMatch(/ends before it starts/)
  })

  it('does not ask for a time when none is claimed', () => {
    expect(submitProblem(sub({ summary: 'x', observed_precision: 'unknown' }))).toBeNull()
  })
})

describe('a draft genuinely has no number', () => {
  it('says Draft rather than inventing a placeholder', () => {
    // Numbers are issued by the database at submit, so there is nothing
    // truthful to show before then.
    expect(submissionRef(sub())).toBe('Draft')
    expect(submissionRef(sub({ submission_no: 'FI-2026-0041' }))).toBe('FI-2026-0041')
  })
})

describe('what an officer may edit', () => {
  it('is drafts, and only drafts', () => {
    expect(isEditableByOfficer('draft')).toBe(true)
    for (const s of FIELD_STATUSES.filter((s) => s !== 'draft')) {
      expect(isEditableByOfficer(s), s).toBe(false)
    }
  })
})

describe('status wording', () => {
  it('gives every status a label and a plain-language meaning', () => {
    for (const s of FIELD_STATUSES) {
      expect(fieldStatusLabel(s), s).toBeTruthy()
      expect(fieldStatusMeaning(s), s).toBeTruthy()
    }
  })

  it('never says "ticket" to an officer', () => {
    // The replacement is explicitly not a ticket system, and the vocabulary is
    // part of that rather than a cosmetic detail.
    for (const s of FIELD_STATUSES) {
      expect(fieldStatusLabel(s).toLowerCase()).not.toContain('ticket')
      expect(fieldStatusMeaning(s).toLowerCase()).not.toContain('ticket')
    }
  })

  it('falls back to the raw value for a status it does not know', () => {
    // The database could gain a status before this file does; showing the raw
    // value beats showing nothing.
    expect(fieldStatusLabel('something_new')).toBe('something_new')
    expect(fieldStatusMeaning('something_new')).toBe('')
  })
})
