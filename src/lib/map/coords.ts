/** Game-world → map transforms for the vendored San Andreas atlas pyramid
 *  (public/map/atlas/{z}_{x}_{y}.jpg, google-scheme, zooms 0–5).
 *
 *  Artwork: Flamm64/GTA-V-World-Map "Atlas" tiles (by Zslash / Martin Floden,
 *  https://github.com/Flamm64/GTA-V-World-Map — "you can edit, modify, share
 *  and republish as long as you modify it"; game-derived, community-tolerated
 *  but unlicensed by the IP holder — see docs/MAPS.md). Zooms 6–7 exist
 *  upstream but are NOT vendored (z6 alone is ~59 MB); MapLibre overzooms the
 *  z5 tiles instead.
 *
 *  The transform is a north-up isotropic affine fitted for THIS pyramid: the
 *  published fivem-leaflet convention (0.02072/117.3/−0.0205/172.8) does not
 *  match Zslash's render, so the fit below was self-calibrated by maximizing
 *  postal-point-on-road alignment across all 1,687 postals of
 *  src/lib/map/postals.json, then spot-verified visually (postal 8022 →
 *  Downtown LS, 7255 → Backlot City/western LS, 1000 → Great Ocean Hwy near
 *  Procopio Beach in the far north). Pixel space is the 256 px zoom-0 tile;
 *  multiply by 2^z for a deeper zoom.
 *
 *  Pure module — no DOM, no MapLibre import — so it unit-tests in node. */

/** Calibrated affine: pixel(z0) = GAME_TO_PX.s * gameX + GAME_TO_PX.bx, etc. */
export const GAME_TO_PX = { s: 0.01255, bx: 122.1, by: 154.9 } as const

/** Zoom-0 world size of a google-scheme pyramid (one 256 px tile). */
export const WORLD_PX = 256

export interface PixelPoint {
  /** Pixel x at zoom 0 (0…256, west→east). */
  x: number
  /** Pixel y at zoom 0 (0…256, north→south). */
  y: number
}

/** Game coordinates (metres, y grows northward) → zoom-0 pixel position. */
export function gameToPixel(gameX: number, gameY: number): PixelPoint {
  return {
    x: GAME_TO_PX.s * gameX + GAME_TO_PX.bx,
    y: -GAME_TO_PX.s * gameY + GAME_TO_PX.by,
  }
}

/** Zoom-0 pixel position → [lng, lat] on the pseudo-mercator world MapLibre
 *  renders. The pyramid is treated as a full web-mercator globe (the standard
 *  trick for game maps): x maps linearly to longitude, y through the inverse
 *  Gudermannian. Distortion is irrelevant — the transform is exact for
 *  placing points on the very tiles it was calibrated against. */
export function pixelToLngLat(px: number, py: number): [number, number] {
  const lng = (px / WORLD_PX) * 360 - 180
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / WORLD_PX))) * 180) / Math.PI
  return [lng, lat]
}

/** Game coordinates → [lng, lat] (composition of the two steps above). */
export function gameToLngLat(gameX: number, gameY: number): [number, number] {
  const { x, y } = gameToPixel(gameX, gameY)
  return [pixelToLngLat(x, y)[0], pixelToLngLat(x, y)[1]]
}

/** Loose world-bounds of the playable San Andreas rectangle in game metres —
 *  padded past every postal (x −3428…3752, y −3464…6675) so pan constraints
 *  never clip a marker. Roxwood or other custom-island coordinates would fall
 *  outside; they are expected to arrive as unmatched AREA STRINGS and resolve
 *  to "unplaced" in the gazetteer instead (graceful degradation). */
export const GAME_BOUNDS = { west: -4300, east: 4700, south: -4400, north: 8000 } as const

/** [[west, south], [east, north]] lng/lat bounds for MapLibre maxBounds /
 *  fitBounds. */
export function mapBounds(): [[number, number], [number, number]] {
  const sw = gameToLngLat(GAME_BOUNDS.west, GAME_BOUNDS.south)
  const ne = gameToLngLat(GAME_BOUNDS.east, GAME_BOUNDS.north)
  return [sw, ne]
}
