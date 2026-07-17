import { describe, expect, it } from 'vitest'
import { legalHitSublabel } from './search'

/** The search_all RPC emits `initcap(request_type) · replace(review_status,
 *  '_', ' ')` for legal hits; the client re-derives the workflow model's human
 *  status label from that token (the RPC itself is untouchable and untouched). */
describe('legalHitSublabel', () => {
  it('maps the machine status token to the model label', () => {
    expect(legalHitSublabel('Warrant · submitted to doj'))
      .toBe('Warrant · Submitted to DOJ — awaiting assignment')
    expect(legalHitSublabel('Subpoena · returned by ada'))
      .toBe('Subpoena · Returned by ADA')
    expect(legalHitSublabel('Warrant · judicial review'))
      .toBe('Warrant · Judicial review')
    expect(legalHitSublabel('Warrant · approved')).toBe('Warrant · Approved')
  })

  it('keeps the type prefix untouched', () => {
    expect(legalHitSublabel('Warrant · denied')).toBe('Warrant · Denied')
  })

  it('passes unknown tokens and non-legal shapes through unchanged', () => {
    expect(legalHitSublabel('Warrant · some future status')).toBe('Warrant · some future status')
    expect(legalHitSublabel('no separator here')).toBe('no separator here')
    expect(legalHitSublabel('')).toBe('')
    expect(legalHitSublabel(null)).toBeNull()
  })
})
