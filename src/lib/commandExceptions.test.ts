/** Exceptions-first triage.
 *
 *  The property that matters is the one a commander would be misled by: a
 *  count that has not loaded must never be presented as a loaded zero. A
 *  failed read that reads "0 pending membership" is the kind of thing someone
 *  stops checking. */
import { describe, expect, it } from 'vitest'
import { allClearText, countState, splitExceptions } from './commandExceptions'

describe('countState', () => {
  it('separates "nothing waiting" from "we do not know"', () => {
    expect(countState(3)).toBe('attention')
    expect(countState(0)).toBe('clear')
    expect(countState(null)).toBe('unknown')
    expect(countState(undefined)).toBe('unknown')
    expect(countState(Number.NaN), 'a broken number is not a zero').toBe('unknown')
  })
})

describe('splitExceptions', () => {
  const tiles = [
    { label: 'Pending membership', n: 2 },
    { label: 'Sign-offs', n: 0 },
    { label: 'Unassigned intel', n: null },
    { label: 'Overdue tasks', n: 5 },
    { label: 'Legacy transfers', n: 0 },
  ]

  it('keeps the caller’s ranking inside each bucket', () => {
    const s = splitExceptions(tiles, (t) => t.n)
    expect(s.attention.map((t) => t.label)).toEqual(['Pending membership', 'Overdue tasks'])
    expect(s.clear.map((t) => t.label)).toEqual(['Sign-offs', 'Legacy transfers'])
    expect(s.unknown.map((t) => t.label)).toEqual(['Unassigned intel'])
  })

  it('never folds an unread count into the all-clear summary', () => {
    const s = splitExceptions(tiles, (t) => t.n)
    expect(s.clear).not.toContainEqual(expect.objectContaining({ label: 'Unassigned intel' }))
  })
})

describe('allClearText', () => {
  it('says nothing when there is nothing to summarize', () => {
    expect(allClearText([])).toBeNull()
  })

  it('reads as a sentence at every length', () => {
    expect(allClearText(['Sign-offs'])).toBe('Sign-offs: nothing waiting.')
    expect(allClearText(['A', 'B'])).toBe('Nothing waiting on A and B.')
    expect(allClearText(['A', 'B', 'C', 'D', 'E'])).toBe('Nothing waiting on A, B, C and 2 more.')
  })
})
