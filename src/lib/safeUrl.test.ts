import { describe, expect, it } from 'vitest'
import { safeUrl } from './safeUrl'

/** The XSS gate for every DB-sourced href/src. A regression here is a
 *  stored-XSS vector, so the dangerous schemes are pinned by test. */
describe('safeUrl', () => {
  it('allows http/https/mailto and relative URLs', () => {
    expect(safeUrl('https://example.com/x')).toBe('https://example.com/x')
    expect(safeUrl('http://example.com')).toBe('http://example.com')
    expect(safeUrl('mailto:cid@sa.gov')).toBe('mailto:cid@sa.gov')
    expect(safeUrl('/cases?case=abc')).toBe('/cases?case=abc')
    expect(safeUrl('//cdn.example.com/i.png')).toBe('//cdn.example.com/i.png')
  })

  it('blocks script-smuggling schemes', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('')
    expect(safeUrl('JaVaScRiPt:alert(1)')).toBe('')
    expect(safeUrl('data:text/html,<script>1</script>')).toBe('')
    expect(safeUrl('vbscript:msgbox')).toBe('')
    expect(safeUrl('file:///etc/passwd')).toBe('')
  })

  it('blocks control-character obfuscation and empty input', () => {
    expect(safeUrl('java\nscript:alert(1)')).toBe('')
    expect(safeUrl('https://x.com')).toBe('')
    expect(safeUrl('')).toBe('')
    expect(safeUrl(null)).toBe('')
    expect(safeUrl(undefined)).toBe('')
  })
})
