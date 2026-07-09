import { describe, expect, it } from 'vitest'
import { fmtUSD, initials, slug } from './format'

describe('format helpers', () => {
  it('slug strips everything unsafe for filenames', () => {
    expect(slug('Vespucci / "Op: Night"')).toBe('Vespucci----Op--Night-')
    expect(slug('')).toBe('case')
    expect(slug(null)).toBe('case')
  })

  it('fmtUSD renders numbers and dashes nulls', () => {
    expect(fmtUSD(1234567)).toBe('$1,234,567')
    expect(fmtUSD(0)).toBe('$0')
    expect(fmtUSD(null)).toBe('—')
    expect(fmtUSD(undefined)).toBe('—')
  })

  it('initials are defensive about odd names', () => {
    expect(initials('Dario Moretti')).toBe('DM')
    expect(initials('  ')).toBe('?')
    expect(initials(null)).toBe('?')
  })
})
