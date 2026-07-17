import { describe, expect, it } from 'vitest'
import { caseLink, normalizeCaseTab } from './caseLinks'

describe('normalizeCaseTab — legacy tab mapping', () => {
  it('maps the retired evidence tab to media (old links keep working)', () => {
    expect(normalizeCaseTab('evidence')).toBe('media')
  })

  it('passes current tab ids through unchanged', () => {
    for (const t of ['overview', 'media', 'reports', 'tasks', 'signoff', 'timeline']) {
      expect(normalizeCaseTab(t)).toBe(t)
    }
  })

  it('passes unknown values through (the shell falls back to overview)', () => {
    expect(normalizeCaseTab('bogus')).toBe('bogus')
  })

  it('null/empty stay null', () => {
    expect(normalizeCaseTab(null)).toBeNull()
    expect(normalizeCaseTab('')).toBeNull()
    expect(normalizeCaseTab(undefined)).toBeNull()
  })
})

describe('caseLink — param order stays stable', () => {
  it('builds media-tab links with a legacy evidence highlight param', () => {
    expect(caseLink('c1', 'media', { evidence: 'e1' })).toBe('/cases?case=c1&tab=media&evidence=e1')
  })

  it('encodes ids', () => {
    expect(caseLink('a b', 'media')).toBe('/cases?case=a%20b&tab=media')
  })
})
