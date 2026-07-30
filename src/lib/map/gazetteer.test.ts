import { describe, expect, it } from 'vitest'
import { normalizeArea, resolveArea } from './gazetteer'

describe('normalizeArea', () => {
  it('trims, lowercases and strips the legacy trailing .0', () => {
    expect(normalizeArea('  Paleto Bay ')).toBe('paleto bay')
    expect(normalizeArea('8022.0')).toBe('8022')
    expect(normalizeArea(' 21.0 ')).toBe('21')
    expect(normalizeArea(null)).toBe('')
    expect(normalizeArea(undefined)).toBe('')
  })

  it('leaves non-trailing decimals alone', () => {
    expect(normalizeArea('route 68.5 marker')).toBe('route 68.5 marker')
  })
})

describe('resolveArea', () => {
  it('resolves exact postal codes precisely', () => {
    const r = resolveArea('8022')
    expect(r).not.toBeNull()
    expect(r!.source).toBe('postal')
    expect(r!.x).toBeCloseTo(-179.77, 1)
    expect(r!.y).toBeCloseTo(-579.82, 1)
  })

  it('resolves legacy "8022.0" imports to the same postal', () => {
    expect(resolveArea(' 8022.0 ')).toEqual(resolveArea('8022'))
  })

  it('resolves named areas case-insensitively', () => {
    const r = resolveArea('  PALETO BAY ')
    expect(r).not.toBeNull()
    expect(r!.source).toBe('area')
    expect(r!.y).toBeGreaterThan(5500) // far north
  })

  it('resolves every area the heatmap silhouette knows', () => {
    // The HM_XY key set from HeatmapView (which stays untouched) — the tile
    // map must recognize at least the same vocabulary.
    const HM_KEYS = [
      'paleto bay', 'mount chiliad', 'grapeseed', 'sandy shores', 'grand senora desert',
      'harmony', 'blaine county', 'chumash', 'banham canyon', 'tataviam mountains',
      'richman', 'morningwood', 'vinewood hills', 'vinewood', 'burton', 'rockford hills',
      'downtown los santos', 'mirror park', 'del perro', 'vespucci', 'vespucci beach',
      'little seoul', 'pillbox hill', 'strawberry', 'davis', 'chamberlain hills', 'la mesa',
      'el burro heights', 'cypress flats', 'murrieta heights', 'rancho', 'port of los santos',
      'la puerta', 'fort zancudo', 'route 68', 'humane labs', 'legion square', 'textile city',
      'hawick', 'alta', 'east vinewood', 'del perro pier', 'elysian island', 'terminal',
      'palomino highlands', 'great chaparral', 'stab city', 'grape seed', 'north chumash',
      'galilee',
    ]
    for (const key of HM_KEYS) {
      expect(resolveArea(key), key).not.toBeNull()
    }
  })

  it('returns null (→ unplaced) for unknown areas, unknown postals and blanks', () => {
    expect(resolveArea('Roxwood Docks')).toBeNull() // custom island — unmapped by design
    expect(resolveArea('99999')).toBeNull() // no such postal
    expect(resolveArea('')).toBeNull()
    expect(resolveArea('   ')).toBeNull()
    expect(resolveArea(null)).toBeNull()
    expect(resolveArea(undefined)).toBeNull()
  })
})
