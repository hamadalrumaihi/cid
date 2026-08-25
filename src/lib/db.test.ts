import { describe, expect, it } from 'vitest'
import { ilikeAny, removeWhere } from './db'

/** Offline-safe pins for the data-layer helpers that guard themselves BEFORE
 *  touching the client. (Query behavior itself is covered by the MSW and RLS
 *  suites — this file never reaches the network.) */

describe('removeWhere — unscoped-delete guard', () => {
  it('throws before building any query when the predicate is empty', async () => {
    await expect(removeWhere('watchlist', {})).rejects.toThrow(/unscoped delete/)
    await expect(removeWhere('watchlist', { eq: {} })).rejects.toThrow(/unscoped delete/)
    await expect(removeWhere('watchlist', { eq: {}, is: {} })).rejects.toThrow(/unscoped delete/)
  })
})

describe('ilikeAny — PostgREST or() injection guard', () => {
  it('strips PostgREST syntax characters from the term', () => {
    expect(ilikeAny(['name'], 'a,b(c)%d_e*f')).toBe('name.ilike.*a b c d e f*')
  })
  it('returns null for a blank term', () => {
    expect(ilikeAny(['name'], '   ')).toBeNull()
    expect(ilikeAny(['name'], '%*_')).toBeNull()
  })
})
