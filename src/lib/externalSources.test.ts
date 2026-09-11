/** Pins for the pure external-source helpers: the status / verification /
 *  reliability wording (UNVERIFIED INTELLIGENCE is explicit, never
 *  "pending"), the diff-summary chip text, the display domain and the
 *  client-side URL sanity check. */
import { describe, expect, it } from 'vitest'
import {
  RELIABILITIES, SOURCE_LINK_KINDS, SOURCE_STATUSES, UNVERIFIED_LABEL, VERIFICATION_STATUSES, diffSummaryText, domainOf,
  isVerified, parseDiffSummary, reliabilityLabel, reliabilityTone, sourceStatusLabel, sourceStatusTone, urlProblem,
  verificationLabel, verificationTone,
} from './externalSources'

describe('vocabulary', () => {
  it('mirrors the CHECK constraints', () => {
    expect(SOURCE_STATUSES).toEqual(['pending', 'fetching', 'ready', 'changed', 'failed'])
    expect(VERIFICATION_STATUSES).toEqual(['unverified', 'verified', 'disputed', 'rejected'])
    expect(RELIABILITIES).toEqual(['unknown', 'reliable', 'usually_reliable', 'unreliable', 'cannot_judge'])
    expect(SOURCE_LINK_KINDS).toEqual(['case', 'person', 'vehicle', 'gang', 'place', 'narcotic', 'evidence', 'report', 'intel'])
  })

  it('labels every status and falls back gracefully', () => {
    expect(SOURCE_STATUSES.map(sourceStatusLabel)).toEqual(['Pending', 'Fetching', 'Ready', 'Changed', 'Failed'])
    expect(sourceStatusLabel(null)).toBe('—')
    expect(sourceStatusLabel('odd_state')).toBe('odd state')
    expect(sourceStatusTone('failed')).toBe('danger')
    expect(sourceStatusTone('changed')).toBe('warn')
    expect(sourceStatusTone('ready')).toBe('good')
  })

  it('says UNVERIFIED INTELLIGENCE for anything not verified/disputed/rejected', () => {
    expect(UNVERIFIED_LABEL).toBe('UNVERIFIED INTELLIGENCE')
    expect(verificationLabel('unverified')).toBe(UNVERIFIED_LABEL)
    expect(verificationLabel(null)).toBe(UNVERIFIED_LABEL)
    expect(verificationLabel('verified')).toBe('Verified')
    expect(verificationLabel('disputed')).toBe('Disputed')
    expect(verificationLabel('rejected')).toBe('Rejected')
    expect(verificationTone('unverified')).toBe('warn')
    expect(verificationTone('verified')).toBe('good')
    expect(isVerified('verified')).toBe(true)
    expect(isVerified('disputed')).toBe(false)
  })

  it('labels reliability', () => {
    expect(RELIABILITIES.map(reliabilityLabel)).toEqual(['Unknown reliability', 'Reliable', 'Usually reliable', 'Unreliable', 'Cannot be judged'])
    expect(reliabilityLabel(undefined)).toBe('Unknown reliability')
    expect(reliabilityTone('unreliable')).toBe('danger')
    expect(reliabilityTone('unknown')).toBe('neutral')
  })
})

describe('diff summary', () => {
  it('parses the server shape and computes modified when absent', () => {
    expect(parseDiffSummary({ added: 12, removed: 3, added_samples: ['a', 'b'], removed_samples: ['c'] }))
      .toEqual({ added: 12, removed: 3, modified: 3, addedSamples: ['a', 'b'], removedSamples: ['c'] })
    expect(parseDiffSummary({ added: 2, removed: 5, modified: 1 })?.modified).toBe(1)
    expect(parseDiffSummary(null)).toBeNull()
    expect(parseDiffSummary('nope')).toBeNull()
    expect(parseDiffSummary([1])).toBeNull()
    expect(parseDiffSummary({ added: -4, removed: 'x' })).toEqual({ added: 0, removed: 0, modified: 0, addedSamples: [], removedSamples: [] })
  })

  it('renders "+12 −3 ~3 lines"', () => {
    expect(diffSummaryText({ added: 12, removed: 3 })).toBe('+12 −3 ~3 lines')
    expect(diffSummaryText({ added: 0, removed: 0 })).toBe('no line changes')
    expect(diffSummaryText(null)).toBe('')
    expect(diffSummaryText({ added: 1, removed: 0, modified: 0, addedSamples: [], removedSamples: [] })).toBe('+1 −0 ~0 lines')
  })
})

describe('domainOf / urlProblem', () => {
  it('lower-cases the host and strips www.', () => {
    expect(domainOf('https://WWW.Example.com/path?q=1')).toBe('example.com')
    expect(domainOf('http://news.example.org')).toBe('news.example.org')
    expect(domainOf('ftp://example.com')).toBe('')
    expect(domainOf('not a url')).toBe('')
    expect(domainOf('')).toBe('')
    expect(domainOf(null)).toBe('')
  })

  it('refuses the obvious before the server does', () => {
    expect(urlProblem('')).toMatch(/Enter a URL/)
    expect(urlProblem('example.com')).toMatch(/http/)
    expect(urlProblem('javascript:alert(1)')).toMatch(/http/)
    expect(urlProblem('https://user:pw@example.com')).toMatch(/credentials/)
    expect(urlProblem('http://localhost/x')).toMatch(/Internal/)
    expect(urlProblem('http://box.internal/x')).toMatch(/Internal/)
    expect(urlProblem(`https://example.com/${'a'.repeat(2100)}`)).toMatch(/2048/)
    expect(urlProblem('https://example.com/article')).toBeNull()
  })
})
