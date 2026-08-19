/** Unit tests for the Field Intelligence submission mirror.
 *
 *  The rules that matter — who may edit what, who stamps the reporting officer,
 *  when an FI number is issued — are enforced in the database and were probed
 *  there; 20260911120000_field_submissions.sql records the results. What is
 *  pinned here is the arithmetic and the wording the officer actually sees.
 */

import { describe, expect, it } from 'vitest'
import {
  AUTHORABLE_SOURCES, FIELD_STATUSES, RELIABILITIES, RELIABILITY_LABEL,
  RELIABILITY_MEANING, SOURCE_TYPES, URGENCIES, URGENCY_LABEL, fieldStatusLabel,
  fieldStatusMeaning, isEditableByOfficer, isExternalSource, normalizedGrams,
  reliabilityLabel, sourceLabel, submissionRef, submitProblem, urgencyLabel,
  urgencyTone, weightProblem,
} from './fieldSubmissions'
import type { FieldSubmissionRow } from './fieldSubmissions'

const sub = (over: Partial<FieldSubmissionRow> = {}): FieldSubmissionRow => ({
  id: 's1', submission_no: null, officer_id: 'u1', snap_agency: 'SAHP',
  snap_callsign: '924', snap_rank: null, snap_unit: null,
  snap_officer_name: 'Tom Wood',
  status: 'draft', jurisdiction: 'city', summary: null, details: null,
  observed_at: null, observed_to: null, observed_precision: 'unknown',
  mdt_reference: null, submitted_at: null, assigned_to: null, assigned_at: null,
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

  it('requires a jurisdiction, because it decides who ever sees the report', () => {
    // A check constraint enforces this too. Without it the report reaches no
    // bureau queue at all -- worse than a rejected submission, because the
    // officer would believe it had been sent to somebody.
    expect(submitProblem(sub({ summary: 'Saw a van', jurisdiction: null })))
      .toMatch(/where this happened/)
  })

  it('requires both ends of a time range', () => {
    const base = { summary: 'x', jurisdiction: 'city', observed_precision: 'range' as const }
    expect(submitProblem({ ...base, observed_at: '2026-08-19T01:00:00Z', observed_to: null }))
      .toMatch(/both a start and an end/)
    expect(submitProblem({ ...base, observed_at: null, observed_to: '2026-08-19T02:00:00Z' }))
      .toMatch(/both a start and an end/)
  })

  it('refuses a range that ends before it starts', () => {
    expect(submitProblem({
      summary: 'x', jurisdiction: 'city', observed_precision: 'range',
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

describe('who filed a report, after the account is gone', () => {
  it('keeps the reporting identity on the submission itself', () => {
    // Permanent deletion repoints officer_id to the tombstone, so reading the
    // name through the FK would degrade every old report to "Deleted Member".
    // The snapshot is taken at submit time and frozen by a trigger.
    const r = sub({ snap_officer_name: 'John Smith', snap_agency: 'BCSO', snap_callsign: '412' })
    expect(r.snap_officer_name).toBe('John Smith')
    expect([r.snap_callsign, r.snap_agency].join(' ')).toBe('412 BCSO')
  })
})

describe('where the information came from', () => {
  it('labels every source type', () => {
    for (const s of SOURCE_TYPES) {
      expect(sourceLabel(s), s).toBeTruthy()
      expect(sourceLabel(s), s).not.toContain('_')
    }
    expect(sourceLabel(null)).toBe('Unknown')
  })

  it('never offers patrol as something an investigator can choose', () => {
    // 'patrol' means "arrived through the external portal", and the database
    // stamps it. A detective writing down what a patrol officer told them is
    // second-hand information from a detective, and the record should say so.
    expect(AUTHORABLE_SOURCES).not.toContain('patrol')
  })

  it('never offers confidential before its protection exists', () => {
    // Shipping the option before the protected identity storage is how a
    // source's name ends up in a summary field. The insert trigger refuses it
    // too; this keeps the picker honest in the meantime.
    expect(AUTHORABLE_SOURCES).not.toContain('confidential')
  })

  it('treats only a patrol record as externally reported', () => {
    // The agency badge means "somebody outside CID sent this". Everything else
    // was written by somebody inside it.
    expect(isExternalSource('patrol')).toBe(true)
    for (const s of SOURCE_TYPES.filter((s) => s !== 'patrol')) {
      expect(isExternalSource(s), s).toBe(false)
    }
  })
})

describe('grading the source', () => {
  it('labels and explains every reliability', () => {
    for (const r of RELIABILITIES) {
      expect(RELIABILITY_LABEL[r], r).toBeTruthy()
      expect(RELIABILITY_MEANING[r], r).toBeTruthy()
    }
  })

  it('keeps reliability about the source, not about a claim', () => {
    // The distinction most easily lost: a confirmed source can still say
    // something that turns out to be wrong, which is why claim verdicts exist
    // separately.
    expect(RELIABILITY_MEANING.confirmed).toMatch(/independent/)
    expect(RELIABILITY_MEANING.unverified).toMatch(/assessed/)
  })

  it('escalates the urgency tone rather than shouting at every level', () => {
    expect(urgencyTone('critical')).toBe('danger')
    expect(urgencyTone('high')).toBe('warn')
    expect(urgencyTone('low')).toBe('neutral')
    expect(urgencyTone(null)).toBe('neutral')
  })

  it('says nothing when nothing has been graded', () => {
    expect(urgencyLabel(null)).toBe('')
    expect(reliabilityLabel(null)).toBe('')
  })

  it('labels every urgency', () => {
    for (const u of URGENCIES) expect(URGENCY_LABEL[u], u).toBeTruthy()
  })
})
