/** Unit tests for SIU handling of a Field Intelligence report.
 *
 *  The rules are in the database and were probed live: only SIU answers a
 *  referral, only the Special Agent in Charge assigns SIU work (a CID Bureau
 *  Lead is refused), a corruption referral restricts the report to SIU plus the
 *  officer, referrer and assignee, and follow-up candidates are readable by SIU
 *  and nobody else. 20260918120000_field_siu_referral.sql records the results.
 *  What is pinned here is the wording and the arithmetic a reviewer sees.
 */

import { describe, expect, it } from 'vitest'
import {
  FOLLOWUP_KINDS, SENSITIVE_CATEGORY, SIU_CATEGORIES, SIU_STATES,
  canFlag, canRefer, followupLabel, referralProblem, referralWarning,
  siuActionLine, siuCategoryLabel, siuStateLabel, siuStateMeaning, siuStateTone,
} from './fieldSiu'
import type { FieldSiuActionRow } from './fieldSiu'
import { SIU_FILTERS, SIU_FILTER_LABEL, matchesFilter } from './fieldReview'
import type { FieldSubmissionRow } from './fieldSubmissions'

const act = (over: Partial<FieldSiuActionRow> = {}): FieldSiuActionRow => ({
  id: 'a1', submission_id: 's1', action: 'flagged', actor_id: 'd1',
  category: 'organized_crime', reason: null, from_user: null, to_user: null,
  created_at: '2026-08-19T00:00:00Z', ...over,
})

const sub = (over: Partial<FieldSubmissionRow> = {}): FieldSubmissionRow => ({
  id: 's1', submission_no: 'FI-2026-0001', officer_id: 'u1', snap_agency: 'SAHP',
  snap_callsign: '924', snap_rank: null, snap_unit: null,
  status: 'reviewing', jurisdiction: 'city', summary: 'x', details: null,
  observed_at: null, observed_to: null, observed_precision: 'unknown',
  mdt_reference: null, submitted_at: '2026-08-19T00:00:00Z',
  assigned_to: null, assigned_at: null,
  siu_state: null, siu_category: null, siu_reason: null,
  siu_referred_by: null, siu_referred_at: null,
  siu_assigned_to: null, siu_assigned_at: null, siu_sensitive: false,
  created_at: '2026-08-19T00:00:00Z', updated_at: '2026-08-19T00:00:00Z',
  ...over,
})

describe('a flag is not a case', () => {
  it('never calls any state a confirmed SIU case', () => {
    // The whole point of the flag/refer split is that one of them means
    // "somebody thinks" and the other means "SIU is on it". A label that read
    // like a case would collapse the distinction the database is enforcing.
    for (const s of SIU_STATES) {
      expect(siuStateLabel(s).toLowerCase(), s).not.toContain('case')
      expect(siuStateMeaning(s), s).toBeTruthy()
    }
    expect(siuStateMeaning('flagged')).toMatch(/not a referral/)
  })

  it('tones a flag more quietly than real handling', () => {
    expect(siuStateTone('flagged')).toBe('neutral')
    expect(siuStateTone('referred')).toBe('warn')
    expect(siuStateTone('accepted')).toBe('good')
  })

  it('says nothing at all when there is no SIU angle', () => {
    expect(siuStateLabel(null)).toBe('')
    expect(siuStateMeaning(null)).toBe('')
  })

  it('shows an unfamiliar state rather than hiding it', () => {
    expect(siuStateLabel('something_new')).toBe('something_new')
  })
})

describe('what can still be marked', () => {
  it('stops once SIU has it', () => {
    // Flagging a report SIU already took would be noise, and the RPC refuses
    // it — offering the control would be offering a refusal.
    for (const s of ['referred', 'accepted'] as const) {
      expect(canFlag(s), s).toBe(false)
      expect(canRefer(s), s).toBe(false)
    }
  })

  it('allows it before then, and after a decline', () => {
    for (const s of [null, 'flagged', 'declined']) {
      expect(canFlag(s), String(s)).toBe(true)
      expect(canRefer(s), String(s)).toBe(true)
    }
  })
})

describe('referring', () => {
  it('needs a real category and a reason', () => {
    expect(referralProblem('', 'because')).toMatch(/categories/)
    expect(referralProblem('not_a_thing', 'because')).toMatch(/categories/)
    expect(referralProblem('organized_crime', '   ')).toMatch(/why this needs SIU/)
    expect(referralProblem('organized_crime', 'enterprise, not an incident')).toBeNull()
  })

  it('warns before a corruption referral, not after', () => {
    // Referring under this category restricts the report server-side. Somebody
    // finding that out afterwards would reasonably think the report vanished.
    expect(referralWarning(SENSITIVE_CATEGORY)).toMatch(/no longer see this report/)
    expect(referralWarning('organized_crime')).toBeNull()
  })

  it('gives every category a label', () => {
    for (const c of SIU_CATEGORIES) {
      expect(siuCategoryLabel(c), c).toBeTruthy()
      expect(siuCategoryLabel(c), c).not.toContain('_')
    }
    expect(siuCategoryLabel(null)).toBe('Not stated')
  })
})

describe('the SIU history in words', () => {
  const name = (id: string | null) => (id === 'd1' ? 'Reyes' : id === 'x2' ? 'Vance' : 'Someone')

  it('reads as sentences', () => {
    expect(siuActionLine(act(), name)).toBe('Reyes flagged possible organized crime')
    expect(siuActionLine(act({ action: 'referred' }), name))
      .toBe('Reyes referred it to SIU — Organized crime')
    expect(siuActionLine(act({ action: 'accepted' }), name)).toBe('Reyes accepted it for SIU')
    expect(siuActionLine(act({ action: 'assigned', to_user: 'x2' }), name))
      .toBe('Reyes assigned it to Vance')
    expect(siuActionLine(act({ action: 'sensitive_on' }), name))
      .toBe('Reyes restricted this report to SIU')
  })

  it('falls back to the raw action rather than dropping a line', () => {
    expect(siuActionLine(act({ action: 'invented_later' }), name)).toBe('invented_later')
  })
})

describe('follow-up candidates', () => {
  it('names all five without leaking jargon', () => {
    for (const k of FOLLOWUP_KINDS) {
      expect(followupLabel(k), k).toBeTruthy()
      expect(followupLabel(k), k).not.toContain('_')
    }
  })
})

describe('the SIU queues', () => {
  it('gives every SIU filter a label', () => {
    for (const f of SIU_FILTERS) expect(SIU_FILTER_LABEL[f], f).toBeTruthy()
  })

  it('counts a referral as referred only while it is still waiting', () => {
    // A report SIU has already taken is not a referral to work through.
    expect(matchesFilter(sub({ siu_state: 'referred' }), 'siu_referred', null)).toBe(true)
    expect(matchesFilter(sub({ siu_state: 'accepted' }), 'siu_referred', null)).toBe(false)
  })

  it('treats gang and MC enterprise as organized crime', () => {
    // The SOP separates them as categories but they are one queue: an MC IS an
    // organized-crime enterprise, and splitting the queue hides half of it.
    expect(matchesFilter(sub({ siu_category: 'gang_mc_enterprise' }), 'siu_organized_crime', null)).toBe(true)
    expect(matchesFilter(sub({ siu_category: 'organized_crime' }), 'siu_organized_crime', null)).toBe(true)
    expect(matchesFilter(sub({ siu_category: 'fugitive' }), 'siu_organized_crime', null)).toBe(false)
  })

  it('splits the specialties', () => {
    expect(matchesFilter(sub({ siu_category: 'narcotics_trafficking' }), 'siu_narcotics', null)).toBe(true)
    expect(matchesFilter(sub({ siu_category: 'firearms_trafficking' }), 'siu_firearms', null)).toBe(true)
    expect(matchesFilter(sub({ siu_category: 'public_corruption' }), 'siu_corruption', null)).toBe(true)
    expect(matchesFilter(sub({ siu_category: 'fugitive' }), 'siu_fugitive', null)).toBe(true)
  })

  it('is SIU-assigned only when an agent actually holds it', () => {
    expect(matchesFilter(sub({ siu_assigned_to: 'x2' }), 'siu_assigned', null)).toBe(true)
    expect(matchesFilter(sub({ siu_state: 'accepted' }), 'siu_assigned', null)).toBe(false)
  })

  it('leaves the CID queues alone', () => {
    // A referral changes nothing about who holds the report for CID, so an
    // unclaimed report referred to SIU is still unclaimed.
    const r = sub({ siu_state: 'referred', assigned_to: null, status: 'submitted' })
    expect(matchesFilter(r, 'unclaimed', null)).toBe(true)
    expect(matchesFilter(r, 'city', null)).toBe(true)
  })
})
