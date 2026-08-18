/** Unit tests for the penal-code cache.
 *
 *  penal.ts used to be a 162-entry constant, so it needed no tests: the data
 *  was the data. Now it is a cache over `penal_current_charges()`, and the
 *  interesting behaviour is what happens around the edges of that — before the
 *  catalog loads, when a code is unknown, and when a statute leaves its
 *  sentence to a judge. Those are the states that can quietly render a wrong
 *  number, so they are the ones pinned here.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  PENAL_LEVEL_TINT,
  type PenalCharge,
  penalByCode,
  penalCatalog,
  penalLoaded,
  penalRecommend,
  penalSearch,
  penalSentence,
  penalVersionName,
  setPenalCatalog,
} from './penal'

const CATALOG: PenalCharge[] = [
  { id: 'a', code: '(1)05', title: 'Murder, 1st Degree', level: 'Felony', jail: 150, fine: 250000, desc: 'Unlawful killing, willful and premeditated.', stack: true, rico: true },
  { id: 'b', code: '(1)11', title: 'False Imprisonment', level: 'Felony', jail: 20, fine: 20000, desc: 'Restricting movement without justification.' },
  { id: 'c', code: '(3)12', title: 'Terrorism', level: 'Capital', jail: null, fine: 500000, desc: 'Mass violence to cause widespread fear.' },
  { id: 'd', code: '(10)01', title: 'RICO Conspiracy (Modifier)', level: 'Capital', jail: null, fine: 150000, modifier: true, rico: true },
]

beforeEach(() => { setPenalCatalog(CATALOG, 'Test Code 2026') })

describe('an unloaded catalog is not an empty penal code', () => {
  it('reports not-loaded rather than pretending the code is empty', () => {
    setPenalCatalog([], null)
    expect(penalLoaded()).toBe(false)
    expect(penalCatalog()).toEqual([])
    expect(penalVersionName()).toBeNull()
    // The distinction matters: a view must be able to say "loading" instead of
    // rendering an empty statute book, which reads as "there are no statutes".
    expect(penalByCode('(1)05')).toBeNull()
  })

  it('reports loaded once a catalog is set, and names the version', () => {
    expect(penalLoaded()).toBe(true)
    expect(penalVersionName()).toBe('Test Code 2026')
    expect(penalCatalog()).toHaveLength(4)
  })
})

describe('lookup', () => {
  it('finds by code and returns null for an unknown one', () => {
    expect(penalByCode('(1)05')?.title).toBe('Murder, 1st Degree')
    expect(penalByCode('(99)99')).toBeNull()
  })

  it('does not index a codeless statute, but still lists it', () => {
    // A charge can be active with no code; it must not collide with others in
    // the by-code index, and it must not vanish from the catalog either.
    setPenalCatalog([...CATALOG, { id: 'e', code: '', title: 'Unnumbered offense', level: 'Felony', jail: 5, fine: 100 }], 'v')
    expect(penalCatalog()).toHaveLength(5)
    expect(penalByCode('')).toBeNull()
  })
})

describe('sentence formatting', () => {
  it('says JUDGE rather than zero when the code leaves the term to a judge', () => {
    expect(penalSentence(null)).toBe('JUDGE')
    expect(penalSentence(undefined)).toBe('JUDGE')
  })

  it('formats months as years and months', () => {
    expect(penalSentence(0)).toBe('0mo')
    expect(penalSentence(5)).toBe('5mo')
    expect(penalSentence(15)).toBe('1y 3mo')
    expect(penalSentence(150)).toBe('12y 6mo')
  })

  it('leaves a trailing space on a whole number of years (pre-existing)', () => {
    // `(y ? y + "y " : "") + (...).trim()` trims only the second operand, so a
    // whole year keeps the separator. This is what the portal has always
    // rendered; it is pinned here as fact, not endorsed. Changing it is a
    // display change for a different PR, and it is invisible in HTML anyway.
    expect(penalSentence(12)).toBe('1y ')
    expect(penalSentence(24)).toBe('2y ')
  })
})


describe('search', () => {
  it('returns the whole catalog for an empty query', () => {
    expect(penalSearch('')).toHaveLength(4)
    expect(penalSearch(null)).toHaveLength(4)
  })

  it('matches code, title, level and definition', () => {
    expect(penalSearch('(1)05').map((c) => c.code)).toEqual(['(1)05'])
    expect(penalSearch('murder').map((c) => c.code)).toEqual(['(1)05'])
    expect(penalSearch('capital').map((c) => c.code).sort()).toEqual(['(10)01', '(3)12'])
    expect(penalSearch('premeditated').map((c) => c.code)).toEqual(['(1)05'])
  })
})

describe('the RICO flag covers both senses', () => {
  it('marks predicates and modifiers alike, because the pickers always meant both', () => {
    // The database splits these — is_rico for the modifiers, is_rico_predicate
    // for the offenses that can serve as a predicate act. The client flag is
    // the union, which is what the predicate picker and the per-case count
    // have always displayed.
    const flagged = penalCatalog().filter((c) => c.rico).map((c) => c.code).sort()
    expect(flagged).toEqual(['(1)05', '(10)01'])
  })
})

describe('recommendations', () => {
  it('scores by keyword overlap and ignores very short text', () => {
    expect(penalRecommend('ab')).toEqual([])
    expect(penalRecommend(null)).toEqual([])
    const rec = penalRecommend('the suspect committed an unlawful killing, willful and premeditated')
    expect(rec).toContain('(1)05')
  })

  it('honours the limit', () => {
    const rec = penalRecommend('unlawful killing willful premeditated restricting movement justification', 1)
    expect(rec.length).toBeLessThanOrEqual(1)
  })
})

describe('level tint', () => {
  it('covers every class the penal code can carry, including Capital', () => {
    for (const level of ['Infraction', 'Misdemeanor', 'Felony', 'Capital']) {
      expect(PENAL_LEVEL_TINT[level], level).toBeTruthy()
    }
  })
})
