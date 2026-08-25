import { describe, expect, it } from 'vitest'
import { legalReviewTone, statusMeta, statusTitle, type StatusDomain } from './status'

/** The registry contract: every canonical value in every domain resolves to a
 *  non-empty label and a chip class — and the label disambiguations that
 *  motivated the registry (warrant "Return filed" vs legal "Returned by …")
 *  are pinned so they cannot regress. */

const DOMAIN_VALUES: Record<StatusDomain, string[]> = {
  case: ['open', 'active', 'cold', 'closed', 'archived'],
  caseStage: [
    // Stored investigative stage…
    'intake', 'active_investigation', 'legal_process', 'enforcement_ready', 'pending_closure', 'closed',
    // …and the derived assessCase workflow stage (shared domain).
    'investigation', 'awaiting_signoff', 'returned_signoff', 'doj_review', 'dormant',
  ],
  signoff: [
    'none', 'awaiting_bureau_lead', 'awaiting_deputy', 'awaiting_director',
    'approved_deputy', 'approved_complete', 'ready_doj', 'changes_requested', 'denied',
  ],
  legalReview: [
    'not_submitted', 'cid_supervisor_review', 'returned_by_cid', 'siu_command_review',
    'returned_by_siu_command', 'submitted_to_doj', 'ada_review', 'returned_by_ada',
    'submitted_to_da', 'da_review', 'returned_by_da', 'submitted_to_ag', 'ag_review',
    'returned_by_ag', 'submitted_to_judge', 'judicial_review', 'returned_by_judge',
    'approved', 'denied', 'withdrawn', 'prosecutor_queue', 'prosecutor_review',
    'returned_by_prosecutor', 'declined', 'cancelled', 'superseded',
  ],
  warrant: ['draft', 'signed', 'executed', 'returned'],
  fieldSubmission: ['draft', 'new', 'reviewing', 'needs_info', 'reviewed', 'actionable', 'archived'],
  priority: ['low', 'medium', 'high', 'critical'],
  threat: ['low', 'medium', 'high'],
  confidence: ['unverified', 'possible', 'probable', 'confirmed', 'disproven'],
  provenance: ['manually_confirmed', 'confirmed', 'reported', 'inferred', 'disputed', 'historical', 'imported'],
  boloRisk: ['low', 'medium', 'high', 'critical'],
  seizedItem: ['held', 'returned', 'destroyed', 'forfeited', 'other'],
  personReview: ['fresh', 'due', 'stale', 'unreviewed'],
  accountOwnership: ['suspected', 'probable', 'confirmed'],
  caseCharge: ['approved', 'filed', 'convicted', 'dismissed', 'withdrawn'],
}

describe('statusMeta — every domain covers its canonical value set', () => {
  for (const [domain, values] of Object.entries(DOMAIN_VALUES) as [StatusDomain, string[]][]) {
    it(`${domain}: label + cls for ${values.length} values`, () => {
      for (const v of values) {
        const m = statusMeta(domain, v)
        expect(m.label, `${domain}/${v} label`).toBeTruthy()
        expect(m.cls, `${domain}/${v} cls`).toMatch(/bg-|border-/)
      }
    })
  }

  it('unknown values fall back to a neutral chip, never a crash', () => {
    for (const domain of Object.keys(DOMAIN_VALUES) as StatusDomain[]) {
      const m = statusMeta(domain, 'zz_unknown_state')
      expect(m.label).toBeTruthy()
      expect(m.cls).toBeTruthy()
    }
    expect(statusMeta('case', null).cls).toBeTruthy()
    expect(statusMeta('signoff', undefined).label).toBe('Open')
  })
})

describe('label disambiguation — "returned" means three different things', () => {
  it('warrant returned = "Return filed" (complete), keeping the emerald tint', () => {
    const m = statusMeta('warrant', 'returned')
    expect(m.label).toBe('Return filed')
    expect(m.cls).toContain('emerald') // WARRANT_TINT value, unchanged
  })

  it('legal returned_by_* = sent back (rose)', () => {
    const m = statusMeta('legalReview', 'returned_by_judge')
    expect(m.label).toBe('Returned by Judge')
    expect(m.cls).toContain('rose')
  })

  it('seized returned = "Returned to owner" (accent, not rose/emerald)', () => {
    const m = statusMeta('seizedItem', 'returned')
    expect(m.label).toBe('Returned to owner')
    expect(m.cls).toContain('blue-500') // accent-remapped
  })
})

describe('temperature normalizations', () => {
  it('signoff: awaiting → amber, approved* → emerald, ready_doj → accent, bounced → rose', () => {
    expect(statusMeta('signoff', 'awaiting_deputy').cls).toContain('amber')
    expect(statusMeta('signoff', 'approved_deputy').cls).toContain('emerald')
    expect(statusMeta('signoff', 'approved_complete').cls).toContain('emerald')
    expect(statusMeta('signoff', 'ready_doj').cls).toContain('blue-500')
    expect(statusMeta('signoff', 'changes_requested').cls).toContain('rose')
    expect(statusMeta('signoff', 'denied').cls).toContain('rose')
    expect(statusMeta('signoff', 'none').cls).toContain('slate')
  })

  it('boloRisk: high is amber (the orange one-off is gone), critical rose', () => {
    expect(statusMeta('boloRisk', 'high').cls).toContain('amber')
    expect(statusMeta('boloRisk', 'high').cls).not.toContain('orange')
    expect(statusMeta('boloRisk', 'critical').cls).toContain('rose')
    expect(statusMeta('boloRisk', 'low').cls).toContain('slate')
  })

  it('accountOwnership: probable follows confidenceTint (accent), not amber', () => {
    expect(statusMeta('accountOwnership', 'probable').cls).toContain('blue-500')
    expect(statusMeta('accountOwnership', 'suspected').cls).toContain('slate')
    expect(statusMeta('accountOwnership', 'confirmed').cls).toContain('emerald')
  })

  it('fieldSubmission colors: draft slate, new accent, reviewing/needs_info amber, reviewed/actionable emerald', () => {
    expect(statusMeta('fieldSubmission', 'draft').cls).toContain('slate')
    expect(statusMeta('fieldSubmission', 'new').cls).toContain('blue-500')
    expect(statusMeta('fieldSubmission', 'reviewing').cls).toContain('amber')
    expect(statusMeta('fieldSubmission', 'needs_info').cls).toContain('amber')
    expect(statusMeta('fieldSubmission', 'reviewed').cls).toContain('emerald')
    expect(statusMeta('fieldSubmission', 'actionable').cls).toContain('emerald')
    expect(statusMeta('fieldSubmission', 'archived').cls).toBe('bg-white/5 text-slate-500')
  })
})

describe('legalReviewTone — the shared tone logic legalShared re-exports', () => {
  it('matches the historical reviewTone semantics', () => {
    expect(legalReviewTone('approved')).toBe('emerald')
    expect(legalReviewTone('denied')).toBe('rose')
    expect(legalReviewTone('returned_by_ada')).toBe('rose')
    expect(legalReviewTone('ada_review')).toBe('amber')
    expect(legalReviewTone('submitted_to_doj')).toBe('amber')
    expect(legalReviewTone('withdrawn')).toBe('slate')
    expect(legalReviewTone('not_submitted')).toBe('blue')
    expect(legalReviewTone('prosecutor_queue')).toBe('blue')
  })
})

describe('statusTitle — tooltip copy', () => {
  it('joins meaning and actor; undefined when neither exists', () => {
    const awaiting = statusMeta('signoff', 'awaiting_bureau_lead')
    expect(statusTitle(awaiting)).toContain('Next: Bureau Lead')
    expect(statusTitle({ label: 'X', cls: 'y' })).toBeUndefined()
  })

  it('fieldSubmission meanings ride from lib/fieldSubmissions STATUS_MEANING', () => {
    const m = statusMeta('fieldSubmission', 'needs_info')
    expect(m.meaning).toContain('asked you something')
  })
})
