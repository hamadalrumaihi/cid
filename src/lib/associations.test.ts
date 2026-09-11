import { describe, expect, it } from 'vitest'
import {
  AMENDABLE_FIELDS, ASSOCIATION_CLAIMS, ASSOCIATION_CLAIM_LABEL, ASSOCIATION_CLAIM_MEANING, ASSOCIATION_CONFIDENCE,
  ASSOCIATION_CONFIDENCE_LABEL, ASSOCIATION_KINDS, ASSOCIATION_KIND_LABEL, ASSOCIATION_SOURCE_LABEL,
  ASSOCIATION_SOURCE_TYPES, ASSOCIATION_STATUSES, ASSOCIATION_STATUS_LABEL, amendPatch, associationConfidenceLabel,
  associationKindLabel, associationSourceLabel, associationStatusLabel, claimLabel, claimMeaning, decisionNeedsReason,
  isDecided, isPendingAssociation, sortAssociations, type AssociationRow,
} from './associations'

/** The vocabulary mirrors four CHECK constraints in
 *  20261106120000_org_associations_registry_intel.sql. If the server grows a
 *  value and this module does not, the label helpers must humanize it rather
 *  than drop it — a claim that renders as nothing is worse than an ugly one. */

const row = (over: Partial<AssociationRow> = {}): AssociationRow => ({
  id: 'a1',
  direction: 'subject',
  other_kind: 'gang',
  other_id: 'g2',
  other_label: 'Ballas',
  association: 'unconfirmed_association',
  status: 'pending_investigation',
  confidence: null,
  source_type: null,
  note: null,
  first_observed: null,
  last_confirmed: null,
  created_by: 'u1',
  created_by_name: 'Det. Reyes',
  created_at: '2026-09-01T10:00:00.000Z',
  decided_by: null,
  decided_by_name: null,
  decided_at: null,
  decision_note: null,
  ...over,
})

describe('vocabulary — every CHECK value has a label', () => {
  it('claims: 14 values, all labelled and all explained', () => {
    expect(ASSOCIATION_CLAIMS).toHaveLength(14)
    for (const c of ASSOCIATION_CLAIMS) {
      expect(ASSOCIATION_CLAIM_LABEL[c], c).toBeTruthy()
      expect(ASSOCIATION_CLAIM_MEANING[c], c).toBeTruthy()
      expect(claimLabel(c)).toBe(ASSOCIATION_CLAIM_LABEL[c])
      expect(claimMeaning(c)).toBe(ASSOCIATION_CLAIM_MEANING[c])
    }
  })

  it('statuses, confidences, source types and kinds are complete', () => {
    expect(ASSOCIATION_STATUSES).toHaveLength(4)
    for (const s of ASSOCIATION_STATUSES) expect(ASSOCIATION_STATUS_LABEL[s], s).toBeTruthy()
    expect(ASSOCIATION_CONFIDENCE).toHaveLength(5)
    for (const c of ASSOCIATION_CONFIDENCE) expect(ASSOCIATION_CONFIDENCE_LABEL[c], c).toBeTruthy()
    expect(ASSOCIATION_SOURCE_TYPES).toHaveLength(9)
    for (const t of ASSOCIATION_SOURCE_TYPES) expect(ASSOCIATION_SOURCE_LABEL[t], t).toBeTruthy()
    expect(ASSOCIATION_KINDS).toHaveLength(7)
    for (const k of ASSOCIATION_KINDS) expect(ASSOCIATION_KIND_LABEL[k], k).toBeTruthy()
  })

  it('an unconfirmed association is never worded as alliance, merger or control', () => {
    expect(claimLabel('unconfirmed_association')).toBe('Unconfirmed Association')
    expect(associationStatusLabel('pending_investigation')).toBe('Pending Investigation')
    const meaning = ASSOCIATION_CLAIM_MEANING.unconfirmed_association.toLowerCase()
    expect(meaning).toContain('not alliance')
    expect(meaning).toContain('not merger')
    expect(meaning).toContain('not control')
    // The label itself carries none of those words.
    expect(ASSOCIATION_CLAIM_LABEL.unconfirmed_association.toLowerCase()).not.toMatch(/alliance|merger|control/)
  })

  it('the amendable field list is exactly what entity_association_update accepts', () => {
    expect([...AMENDABLE_FIELDS]).toEqual(['note', 'confidence', 'source_type', 'first_observed', 'last_confirmed'])
  })

  it('labels humanize a value the client does not know, and blanks read as —', () => {
    expect(claimLabel('brand_new_claim')).toBe('Brand New Claim')
    expect(associationStatusLabel('under_appeal')).toBe('Under Appeal')
    expect(associationConfidenceLabel('semi_sure')).toBe('Semi Sure')
    expect(associationSourceLabel('drone_footage')).toBe('Drone Footage')
    expect(associationKindLabel('spaceship')).toBe('Spaceship')
    expect(claimLabel(null)).toBe('—')
    expect(associationConfidenceLabel(null)).toBe('—')
    expect(associationSourceLabel(undefined)).toBe('—')
    expect(claimMeaning('brand_new_claim')).toBeUndefined()
    // A blank status is the workflow's own starting point, not a dash.
    expect(associationStatusLabel(null)).toBe('Pending Investigation')
  })
})

describe('workflow predicates', () => {
  it('pending is the only undecided status; a reason is required to confirm or reject', () => {
    expect(isPendingAssociation(row())).toBe(true)
    expect(isPendingAssociation(row({ status: 'confirmed' }))).toBe(false)
    expect(isDecided(row())).toBe(false)
    expect(isDecided(row({ decided_at: '2026-09-02T10:00:00.000Z' }))).toBe(true)
    expect(decisionNeedsReason('confirmed')).toBe(true)
    expect(decisionNeedsReason('rejected')).toBe(true)
    expect(decisionNeedsReason('historical')).toBe(false)
    expect(decisionNeedsReason('pending_investigation')).toBe(false)
  })
})

describe('sortAssociations — pending first, then newest', () => {
  it('mirrors the server ORDER BY and never mutates the input', () => {
    const input = [
      row({ id: 'confirmed-old', status: 'confirmed', created_at: '2026-08-01T00:00:00.000Z' }),
      row({ id: 'pending-old', created_at: '2026-08-02T00:00:00.000Z' }),
      row({ id: 'rejected-new', status: 'rejected', created_at: '2026-09-09T00:00:00.000Z' }),
      row({ id: 'pending-new', created_at: '2026-09-10T00:00:00.000Z' }),
    ]
    const frozen = input.map((r) => r.id)
    expect(sortAssociations(input).map((r) => r.id)).toEqual(['pending-new', 'pending-old', 'rejected-new', 'confirmed-old'])
    expect(input.map((r) => r.id)).toEqual(frozen)
  })

  it('is stable for rows recorded at the same instant', () => {
    const at = '2026-09-01T00:00:00.000Z'
    const input = [row({ id: 'a', created_at: at }), row({ id: 'b', created_at: at }), row({ id: 'c', created_at: at })]
    expect(sortAssociations(input).map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('amendPatch', () => {
  const base = row({ note: 'Both sets of colours', confidence: 'possible', source_type: 'visual_intelligence', first_observed: '2026-08-01', last_confirmed: null })

  it('sends only the keys that actually changed', () => {
    expect(amendPatch(base, { note: 'Both sets of colours', confidence: 'probable' })).toEqual({ confidence: 'probable' })
  })

  it('normalises blank text to null, exactly as the RPC does', () => {
    expect(amendPatch(base, { note: '   ' })).toEqual({ note: null })
  })

  it('returns null when nothing changed — an empty patch is a bad_request', () => {
    expect(amendPatch(base, { note: 'Both sets of colours', source_type: 'visual_intelligence' })).toBeNull()
    expect(amendPatch(base, {})).toBeNull()
    // An untouched null field stays untouched.
    expect(amendPatch(base, { last_confirmed: '' })).toBeNull()
  })

  it('never emits a key outside AMENDABLE_FIELDS', () => {
    const patch = amendPatch(base, { note: 'New note', confidence: 'confirmed', source_type: 'informant', first_observed: '2026-08-02', last_confirmed: '2026-09-01' })
    expect(Object.keys(patch ?? {}).every((k) => (AMENDABLE_FIELDS as readonly string[]).includes(k))).toBe(true)
  })
})
