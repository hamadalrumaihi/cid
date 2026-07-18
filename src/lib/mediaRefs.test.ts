import { describe, expect, it } from 'vitest'
import { mediaRefLine, parseMediaRefEntries, resolveMediaRefText } from './mediaRefs'

const ID = '2b4f0c2e-9a1d-4f6b-8f3a-1c2d3e4f5a6b'

describe('mediaRefLine + parseMediaRefEntries — id-bearing report references', () => {
  it('round-trips a token line', () => {
    const line = mediaRefLine(ID, 'Dashcam still')
    expect(line).toBe(`[media:${ID}] Dashcam still`)
    expect(parseMediaRefEntries(line)).toEqual([{ id: ID, label: 'Dashcam still' }])
  })

  it('legacy plain-text lines (old "title — url" picker output) stay text entries', () => {
    const legacy = 'Warehouse cam — https://cdn.example/x.png'
    expect(parseMediaRefEntries(legacy)).toEqual([{ id: null, label: legacy }])
  })

  it('mixed blobs keep line-by-line semantics; blank lines drop', () => {
    const blob = `Old note line\n\n${mediaRefLine(ID, 'New pick')}\n  hand-typed ref  `
    expect(parseMediaRefEntries(blob)).toEqual([
      { id: null, label: 'Old note line' },
      { id: ID, label: 'New pick' },
      { id: null, label: 'hand-typed ref' },
    ])
  })

  it('a token with no label falls back to "Attachment"', () => {
    expect(parseMediaRefEntries(`[media:${ID}]`)).toEqual([{ id: ID, label: 'Attachment' }])
  })

  it('empty/null input parses to no entries', () => {
    expect(parseMediaRefEntries('')).toEqual([])
    expect(parseMediaRefEntries(null)).toEqual([])
  })
})

describe('resolveMediaRefText — export flattening', () => {
  const lookup = (id: string) => (id === ID ? { title: 'Renamed still', url: 'https://cdn.example/new.png' } : null)

  it('tokens resolve to the CURRENT title — url (rename-proof)', () => {
    expect(resolveMediaRefText(mediaRefLine(ID, 'Old title'), lookup)).toBe('Renamed still — https://cdn.example/new.png')
  })

  it('unresolvable tokens fall back to their label snapshot', () => {
    expect(resolveMediaRefText('[media:00000000-0000-4000-8000-000000000000] Gone photo', lookup)).toBe('Gone photo')
  })

  it('legacy text lines pass through byte-for-byte', () => {
    const legacy = 'Warehouse cam — https://cdn.example/x.png'
    expect(resolveMediaRefText(`${legacy}\n${mediaRefLine(ID, 'x')}`, lookup)).toBe(`${legacy}\nRenamed still — https://cdn.example/new.png`)
  })

  it('a resolved row without a URL exports the title alone', () => {
    expect(resolveMediaRefText(mediaRefLine(ID, 'x'), () => ({ title: 'T', url: null }))).toBe('T')
  })
})
