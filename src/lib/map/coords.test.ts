import { describe, expect, it } from 'vitest'
import { GAME_BOUNDS, WORLD_PX, gameToLngLat, gameToPixel, mapBounds, pixelToLngLat } from './coords'
import postals from './postals.json'

/** The transform was self-calibrated against the vendored atlas pyramid
 *  (coords.ts header); these tests pin the landmark spot-checks that were
 *  verified visually, so an accidental constant edit can't silently shift
 *  every marker into the ocean. */
describe('gameToPixel', () => {
  // Postal 8022 (game −179.77, −579.82) sits in Downtown Los Santos —
  // verified on the stitched z5 artwork at pixel ≈ (119.8, 162.2).
  it('places postal 8022 in Downtown LS', () => {
    const p = gameToPixel(-179.77, -579.82)
    expect(p.x).toBeGreaterThan(117)
    expect(p.x).toBeLessThan(123)
    expect(p.y).toBeGreaterThan(159)
    expect(p.y).toBeLessThan(166)
  })

  // Postal 7255 (−1033.9, −440.2) is Backlot City, WEST of Downtown and
  // slightly north of 8022.
  it('places postal 7255 west of Downtown', () => {
    const p7255 = gameToPixel(-1033.89, -440.16)
    const p8022 = gameToPixel(-179.77, -579.82)
    expect(p7255.x).toBeLessThan(p8022.x - 8)
    expect(p7255.y).toBeLessThan(p8022.y)
  })

  // The 1000-series postals are the far-north coast (Paleto/Procopio):
  // well above (smaller pixel y than) everything in Los Santos.
  it('places postal 1000 in the far north', () => {
    const p = gameToPixel(1644.12, 6456.06)
    expect(p.y).toBeLessThan(80)
    expect(p.y).toBeGreaterThan(60)
  })

  it('is north-up: larger gameY → smaller pixel y', () => {
    expect(gameToPixel(0, 1000).y).toBeLessThan(gameToPixel(0, 0).y)
    expect(gameToPixel(1000, 0).x).toBeGreaterThan(gameToPixel(0, 0).x)
  })
})

describe('pixelToLngLat', () => {
  it('maps the world square onto mercator extremes', () => {
    expect(pixelToLngLat(0, WORLD_PX / 2)).toEqual([-180, 0])
    expect(pixelToLngLat(WORLD_PX, WORLD_PX / 2)).toEqual([180, 0])
    const [, latN] = pixelToLngLat(WORLD_PX / 2, 0)
    expect(latN).toBeCloseTo(85.0511, 3)
  })

  it('is monotonic: north stays north after projection', () => {
    const [, latPaleto] = gameToLngLat(0, 6000)
    const [, latLS] = gameToLngLat(0, -1000)
    expect(latPaleto).toBeGreaterThan(latLS)
  })
})

describe('mapBounds', () => {
  it('contains every postal in the dataset', () => {
    const [[w, s], [e, n]] = mapBounds()
    for (const p of postals as { x: number; y: number; code: string }[]) {
      const [lng, lat] = gameToLngLat(p.x, p.y)
      expect(lng).toBeGreaterThan(w)
      expect(lng).toBeLessThan(e)
      expect(lat).toBeGreaterThan(s)
      expect(lat).toBeLessThan(n)
    }
  })

  it('matches the declared game bounds', () => {
    const [[w, s], [e, n]] = mapBounds()
    const sw = gameToLngLat(GAME_BOUNDS.west, GAME_BOUNDS.south)
    const ne = gameToLngLat(GAME_BOUNDS.east, GAME_BOUNDS.north)
    expect([w, s]).toEqual(sw)
    expect([e, n]).toEqual(ne)
  })
})
