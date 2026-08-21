/** Unit tests for compartmentation.
 *
 *  The access boundary is the database's -- `private.siu_hidden` on the SELECT,
 *  UPDATE and DELETE policies of four registry tables, plus the standing check
 *  at the top of each definer RPC -- and it was probed live for a CID
 *  detective, the Director (deliberately without SIU standing) and the SAC.
 *  Those results are in the delivery notes.
 *
 *  What is pinned here is everything that decides what a person BELIEVES before
 *  they press the button: whether the state they are looking at is described
 *  honestly, and whether the preview names the real audience. A confirmation
 *  dialog that understates who is about to see a record is worse than no
 *  dialog, because it converts a deliberate act into an accident.
 */

import { describe, expect, it } from 'vitest'
import {
  MIN_REASON, compartmentTypeLabel, reasonIsUsable, restrictPreview,
  revealPreview, reviewRank, visibilityActionLabel, visibilityLabel,
} from './siuVisibility'

const row = (over: Partial<Parameters<typeof visibilityLabel>[0]> = {}) => ({
  state: 'siu_only', revealed_to_case_id: null, revealed_to_user_id: null, ...over,
})

describe('describing a compartment', () => {
  it('says SIU only when nothing has been released', () => {
    expect(visibilityLabel(row())).toBe('SIU only')
  })

  it('never calls a narrowed release a release to CID', () => {
    // The distinction the whole feature turns on. A record released to one
    // officer is not "Revealed to CID", and labelling it so would let SIU
    // believe they had shared something the division cannot actually see.
    expect(visibilityLabel(row({ state: 'revealed', revealed_to_user_id: 'u1' })))
      .toBe('Revealed to one officer')
    expect(visibilityLabel(row({ state: 'revealed', revealed_to_case_id: 'c1' })))
      .toBe('Revealed to one case')
    expect(visibilityLabel(row({ state: 'revealed' }))).toBe('Revealed to CID')
  })

  it('keeps a partial release visibly partial', () => {
    expect(visibilityLabel(row({ state: 'partial' }))).toBe('Partially revealed to CID')
  })

  it('does not let an unanswered question read as a decision', () => {
    // 'unclassified' means nobody has decided yet AND the record is visible.
    // Calling it "SIU only" would describe a hiding that is not happening.
    expect(visibilityLabel(row({ state: 'unclassified' }))).toBe('Origin not established')
  })
})

describe('the audit reads as what happened', () => {
  it('distinguishes widening from narrowing', () => {
    expect(visibilityActionLabel('expanded')).toBe('Widened')
    expect(visibilityActionLabel('reduced')).toBe('Narrowed')
  })

  it('has a word for a move that is neither', () => {
    // One case to another is not wider and not narrower. The server refuses to
    // guess, and the label must not guess either.
    expect(visibilityActionLabel('redirected')).toBe('Redirected')
  })

  it('passes an unknown action through rather than inventing one', () => {
    expect(visibilityActionLabel('something_new')).toBe('something_new')
  })
})

describe('the preview names the real audience', () => {
  it('says the whole division when the release is not narrowed', () => {
    expect(revealPreview({})).toContain('every active CID investigator')
  })

  it('names the officer when the release is to one person', () => {
    const t = revealPreview({ toOfficerName: 'Det. Smith' })
    expect(t).toContain('Det. Smith alone')
    expect(t).not.toContain('every active CID investigator')
  })

  it('names the case when the release is to one case', () => {
    expect(revealPreview({ toCaseName: 'CASE-2026-014' }))
      .toContain('everyone with access to CASE-2026-014')
  })

  it('an officer beats a case, because the server refuses both at once', () => {
    expect(revealPreview({ toCaseName: 'CASE-1', toOfficerName: 'Det. Smith' }))
      .toContain('Det. Smith alone')
  })

  it('lists the sections when only part of the record is released', () => {
    expect(revealPreview({ sections: ['identity', 'vehicles'] }))
      .toContain('the identity, vehicles sections of this record')
    expect(revealPreview({ sections: ['identity'] }))
      .toContain('the identity section of this record')
  })

  it('says the release is permanent and attributed', () => {
    expect(revealPreview({})).toContain('recorded permanently')
  })

  it('does not pretend restricting unsays anything', () => {
    // Somebody who already read a record still knows what was in it. A
    // confirmation that implied otherwise would be a lie about what the
    // button does.
    expect(restrictPreview()).toContain('removes access, not knowledge')
  })
})

describe('the reason', () => {
  it('will not accept a keystroke', () => {
    expect(reasonIsUsable('ok')).toBe(false)
    expect(reasonIsUsable('   '.repeat(20))).toBe(false)
  })

  it('accepts a sentence', () => {
    expect(reasonIsUsable('Charging decision made; CID needs the subject.')).toBe(true)
  })

  it('agrees with the floor the server enforces', () => {
    expect(MIN_REASON).toBe(10)
    expect(reasonIsUsable('x'.repeat(MIN_REASON))).toBe(true)
    expect(reasonIsUsable('x'.repeat(MIN_REASON - 1))).toBe(false)
  })
})

describe('the review queue is ordered by how much thought it needs', () => {
  it('puts the genuinely ambiguous records first', () => {
    const likelySiu = { review_note: 'SIU material references it and no CID material does.' }
    const unknowable = { review_note: 'with nothing attached on either side. Origin cannot be told' }
    const shared = { review_note: 'CID material already references it. It stays shared either way' }
    expect([shared, unknowable, likelySiu].map(reviewRank)).toEqual([2, 1, 0])
  })

  it('treats a record with no note as one CID already holds', () => {
    // The safe end of the queue. Being wrong here costs an unnecessary glance;
    // being wrong the other way puts a shared record at the top of a list of
    // things to consider hiding.
    expect(reviewRank({ review_note: null })).toBe(2)
  })
})

describe('naming the registries', () => {
  it('calls a gang an organisation, as the rest of the portal does', () => {
    expect(compartmentTypeLabel('gang')).toBe('Organisation')
    expect(compartmentTypeLabel('person')).toBe('Person')
  })

  it('passes an unknown type through instead of showing a blank', () => {
    expect(compartmentTypeLabel('evidence')).toBe('evidence')
  })
})
