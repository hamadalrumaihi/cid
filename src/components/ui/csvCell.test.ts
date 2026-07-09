import { describe, expect, it } from 'vitest'
import { csvCell } from './DataTable'

/** The CSV export ships user-authored text to spreadsheets — the injection
 *  guard must neutralize formula prefixes and keep RFC-4180 quoting intact. */
describe('csvCell formula-injection guard', () => {
  it('prefixes formula-starting cells with a quote', () => {
    expect(csvCell('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)")
    expect(csvCell('+1234')).toBe("'+1234")
    expect(csvCell('-cmd')).toBe("'-cmd")
    expect(csvCell('@import')).toBe("'@import")
    expect(csvCell('\tX')).toBe("'\tX")
  })

  it('quotes cells containing commas, quotes, or newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"')
  })

  it('combines both when a formula cell also needs quoting', () => {
    expect(csvCell('=HYPERLINK("http://x", "y")')).toBe('"\'=HYPERLINK(""http://x"", ""y"")"')
  })

  it('passes plain text through unchanged', () => {
    expect(csvCell('SAB-9000041')).toBe('SAB-9000041')
    expect(csvCell('')).toBe('')
  })
})
