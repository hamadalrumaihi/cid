/** Unit tests for the Penal Code workspace model.
 *
 *  The rules that matter here are about NOT overstating what the published code
 *  says. Two nullable columns carry that weight: a null penalty beside a
 *  judge_set flag means "a judge decides", never zero; and a null
 *  arrest_required means the version is silent, never "a citation will do".
 *  The database keeps both nullable for exactly that reason, and the screen has
 *  to be as careful as the column.
 */

import { describe, expect, it } from 'vitest'
import type { PenalCharge } from './penal'
import {
  NO_FILTERS, activeFilterCount, arrestLabel, byPenalTitle, compareCharges,
  filterAvailability, fineLabel, jailLabel, matchesCharge,
} from './penalWorkspace'

const charge = (over: Partial<PenalCharge> = {}): PenalCharge => ({
  id: 'c1', code: '5C01', title: 'Tampering with evidence', level: 'Felony',
  jail: 24, fine: 5000, ...over,
})

describe('penalties are never overstated', () => {
  it('says a judge decides rather than showing nothing', () => {
    // judge_set_fine with a null fine is the database's way of saying the
    // penalty exists but is not fixed. Rendering an empty cell would read as
    // "no fine", which is the opposite.
    expect(fineLabel(charge({ fine: null, judgeFine: true }))).toBe('Set by the judge')
    expect(jailLabel(charge({ jail: null, judgeJail: true }))).toBe('Set by the judge')
  })

  it('distinguishes "not stated" from "none"', () => {
    expect(fineLabel(charge({ fine: null }))).toBe('Not stated')
    expect(jailLabel(charge({ jail: null }))).toBe('Not stated')
    expect(jailLabel(charge({ jail: 0 }))).toBe('No custodial term')
  })

  it('formats a term the way a charge sheet reads', () => {
    expect(jailLabel(charge({ jail: 24 }))).toBe('2y')
    expect(jailLabel(charge({ jail: 30 }))).toBe('2y 6mo')
    expect(jailLabel(charge({ jail: 6 }))).toBe('6mo')
  })

  it('never turns silence about arrest into a claim', () => {
    // arrest_required is nullable because a version that says nothing is not a
    // version that permits a citation.
    expect(arrestLabel(charge({ arrest: true }))).toBe('Arrest required')
    expect(arrestLabel(charge())).toBe('The code does not say')
  })
})

describe('filtering', () => {
  it('searches the code, the offense, the title of code and the definition', () => {
    const c = charge({ penalTitle: 'Title 5C', desc: 'Destroying evidence' })
    for (const q of ['5c01', 'tampering', 'title 5c', 'destroying']) {
      expect(matchesCharge(c, { ...NO_FILTERS, q })).toBe(true)
    }
    expect(matchesCharge(c, { ...NO_FILTERS, q: 'burglary' })).toBe(false)
  })

  it('only admits offenses the code actually says require an arrest', () => {
    expect(matchesCharge(charge({ arrest: true }), { ...NO_FILTERS, arrestOnly: true })).toBe(true)
    // Silence must not be filtered in as if it were a requirement.
    expect(matchesCharge(charge(), { ...NO_FILTERS, arrestOnly: true })).toBe(false)
  })

  it('treats a predicate act and a modifier alike for the RICO filter', () => {
    expect(matchesCharge(charge({ rico: true }), { ...NO_FILTERS, ricoOnly: true })).toBe(true)
    expect(matchesCharge(charge(), { ...NO_FILTERS, ricoOnly: true })).toBe(false)
  })

  it('counts only filters that actually narrow the list', () => {
    // The query box is not a filter chip -- it has its own visible input, and
    // counting it would make "Clear 1 filter" appear while typing.
    expect(activeFilterCount({ ...NO_FILTERS, q: 'anything' })).toBe(0)
    expect(activeFilterCount({ ...NO_FILTERS, level: 'Felony', ricoOnly: true })).toBe(2)
  })
})

describe('grouping', () => {
  it('groups by the title of the code and keeps the uncategorised at the end', () => {
    const groups = byPenalTitle([
      charge({ id: 'a', penalTitle: 'Title 9' }),
      charge({ id: 'b' }),
      charge({ id: 'c', penalTitle: 'Title 5C' }),
    ])
    expect(groups.map((g) => g.title)).toEqual(['Title 5C', 'Title 9', 'Uncategorised'])
    // An offense with no recorded title still appears; it does not vanish.
    expect(groups[2].charges).toHaveLength(1)
  })
})

describe('comparison', () => {
  it('needs at least two offenses to say anything', () => {
    expect(compareCharges([charge()])).toEqual([])
  })

  it('marks the rows where the two actually part company', () => {
    const rows = compareCharges([
      charge({ id: 'a', level: 'Felony', jail: 24 }),
      charge({ id: 'b', level: 'Misdemeanor', jail: 24 }),
    ])
    expect(rows.find((r) => r.label === 'Class')?.differs).toBe(true)
    // Identical rows are the noise; only the differences are the reason to put
    // two offenses side by side.
    expect(rows.find((r) => r.label === 'Custodial term')?.differs).toBe(false)
  })

  it('keeps a predicate act distinct from a RICO modifier', () => {
    const rows = compareCharges([
      charge({ id: 'a', rico: true, predicate: true }),
      charge({ id: 'b', rico: true }),
    ])
    const rico = rows.find((r) => r.label === 'RICO')
    expect(rico?.values).toEqual(['Designated predicate act', 'RICO modifier'])
    expect(rico?.differs).toBe(true)
  })
})

describe('a filter is only offered when the code in force can satisfy it', () => {
  it('withholds the arrest filter when no offense states a requirement', () => {
    // The published 2026 code leaves arrest_required null on all 195 offenses.
    // An "Arrest required" checkbox against it is a control that can only ever
    // return nothing — the same defect as a predicate picker offered against a
    // code that designates no predicates.
    expect(filterAvailability([charge(), charge({ id: 'b' })]).arrest).toBe(false)
    expect(filterAvailability([charge({ arrest: true })]).arrest).toBe(true)
  })

  it('offers only the schedules the code actually uses', () => {
    expect(filterAvailability([charge({ schedule: 2 }), charge({ id: 'b' })]).schedules)
      .toEqual([2])
    expect(filterAvailability([charge()]).schedules).toEqual([])
  })

  it('reads availability from the loaded catalog, never a hardcoded list', () => {
    // So a future version of the code that does record arrests lights the
    // filter up on its own, with no code change.
    const a = filterAvailability([charge({ rico: true, stack: true, pdExempt: true })])
    expect([a.rico, a.stackable, a.pdExempt]).toEqual([true, true, true])
    const none = filterAvailability([charge()])
    expect([none.rico, none.stackable, none.pdExempt]).toEqual([false, false, false])
  })
})
