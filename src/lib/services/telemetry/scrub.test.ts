/** Scrubber pins (platform upgrade decision #10): nothing that can carry
 *  case content leaves the browser, CI numbers drop the whole event. */
import { describe, expect, it } from 'vitest'
import { MESSAGE_MAX, REDACTED, scrubEvent, scrubValue, stripQuery, truncate } from './scrub'

describe('scrubEvent', () => {
  it('drops request bodies, cookies, headers and query strings', () => {
    const out = scrubEvent({
      message: 'boom',
      request: { url: 'https://portal.example/cases?case=abc&tab=media#x', method: 'GET', headers: { Authorization: 'Bearer x' }, cookies: 'sb=1', data: { narrative: 'secret' }, query_string: 'case=abc' },
    })!
    expect(out.request).toEqual({ url: 'https://portal.example/cases', method: 'GET' })
  })

  it('redacts breadcrumb messages and keeps only structural data (URLs without queries)', () => {
    const out = scrubEvent({
      message: 'boom',
      breadcrumbs: [
        { category: 'fetch', message: 'GET /rest/v1/reports?select=fields', data: { method: 'GET', url: '/rest/v1/reports?select=fields', status_code: 200, body: '{"fields":1}' } },
        { category: 'ui.click', message: 'div.narrative > p "John Doe met the source"' },
      ],
    })!
    expect(out.breadcrumbs).toEqual([
      { category: 'fetch', message: REDACTED, data: { method: 'GET', status_code: 200, url: '/rest/v1/reports' }, level: undefined, timestamp: undefined, type: undefined },
      { category: 'ui.click', message: REDACTED, level: undefined, timestamp: undefined, type: undefined },
    ])
  })

  it('removes sensitive keys from extra / tags / contexts / user, at any depth', () => {
    const out = scrubEvent({
      message: 'boom',
      extra: { body: 'x', text: 'x', narrative: 'x', summary: 'x', notes: 'x', fields: {}, token: 'x', authorization: 'x', cookie: 'x', url: 'x', keep: 'ok', nested: { note: 'x', deep: { report_text: 'x', id: 'abc' } } },
      tags: { route: '/cases', request_url: 'https://x/y?z=1' },
      user: { id: 'u1', email: 'a@b.c', ip_address: '1.2.3.4' },
      contexts: { state: { summary: 'x', size: 3 } },
    })!
    expect(out.extra).toEqual({ keep: 'ok', nested: { deep: { id: 'abc' } } })
    expect(out.tags).toEqual({ route: '/cases' })
    expect(out.user).toEqual({ id: 'u1', ip_address: '1.2.3.4' })
    expect(out.contexts).toEqual({ state: { size: 3 } })
  })

  it('truncates messages and exception values to 300 characters', () => {
    const long = 'x'.repeat(1000)
    const out = scrubEvent({ message: long, exception: { values: [{ type: 'Error', value: long }] } })!
    expect(out.message).toHaveLength(MESSAGE_MAX + 1)
    expect(out.message!.endsWith('…')).toBe(true)
    expect(out.exception!.values![0].value).toHaveLength(MESSAGE_MAX + 1)
    expect(truncate('short')).toBe('short')
  })

  it('DROPS an event whose message or exception mentions a CI number', () => {
    expect(scrubEvent({ message: 'failed to load CI-000123' })).toBeNull()
    expect(scrubEvent({ exception: { values: [{ value: 'source ci-42 missing' }] } })).toBeNull()
    expect(scrubEvent({ message: 'CID-26-0101 not found' })).not.toBeNull() // a case number is fine
    expect(scrubEvent({ message: 'ci_search failed' })).not.toBeNull() // an RPC name is not a CI number
  })

  it('strips query strings from URL-shaped strings inside values', () => {
    expect(stripQuery('https://a.b/c/d?e=1#f')).toBe('https://a.b/c/d')
    expect(stripQuery('/cases?case=1')).toBe('/cases')
    expect(stripQuery('')).toBe('')
    expect(scrubValue({ href: 'https://a.b/c?x=1' })).toEqual({ href: 'https://a.b/c' })
    expect(scrubValue(['/legal?request=1', 42, null])).toEqual(['/legal', 42, null])
  })

  it('leaves an event without sensitive fields intact', () => {
    const ev = { message: 'TypeError: x is undefined', level: 'error', tags: { route: '/inbox' } }
    expect(scrubEvent(ev)).toEqual(ev)
  })
})
