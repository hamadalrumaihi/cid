/** Area-string → map-position gazetteer for the investigation map.
 *
 *  CID records store location as a free-text `area` (cases.area, places.area,
 *  gang_turf.hotspot_area…): sometimes a postal code ("8022", legacy imports
 *  "8022.0"), sometimes a neighborhood name ("Paleto Bay"). This module
 *  resolves that string to game coordinates:
 *    (a) exact postal-code match against src/lib/map/postals.json;
 *    (b) the named-area table below (the same ~50 areas the Commander
 *        Heatmap's HM_XY silhouette table recognizes, re-anchored to real
 *        game coordinates for the tile map — HeatmapView is untouched);
 *    (c) null → the caller surfaces the record as "unplaced".
 *
 *  postals.json source: https://github.com/DevBlocky/nearest-postal
 *  (new-postals.json, MIT © 2019 BlockBa5her), the standard FiveM "New &
 *  Improved Postal Code Map v1.1" dataset — 1,687 codes, 1000–10140, game
 *  coordinates x −3428…3752 / y −3464…6675. The coordinate data itself is
 *  game-derived community work (see docs/MAPS.md).
 *
 *  Roxwood (this server's custom island) has no postals and no named areas
 *  here yet, so its records resolve to null and degrade to the "unplaced"
 *  list by design; docs/MAPS.md describes how to add server-owner data.
 *
 *  Pure module (JSON import only) — unit-tests in node. */
import postalsRaw from './postals.json'

interface PostalEntry {
  x: number
  y: number
  code: string
}

const POSTALS: ReadonlyMap<string, PostalEntry> = new Map(
  (postalsRaw as PostalEntry[]).map((p) => [p.code, p]),
)

/** Named areas → approximate game coordinates (metres). The same area names
 *  HeatmapView's HM_XY table recognizes, re-anchored from its stylized
 *  100×130 silhouette onto real game space and spot-checked against the
 *  atlas artwork. Fuzzy by nature — a neighborhood is a region, not a point. */
const AREA_XY: Record<string, [number, number]> = {
  'paleto bay': [-275, 6230], 'mount chiliad': [450, 5570], 'grapeseed': [1680, 4750],
  'sandy shores': [1850, 3690], 'grand senora desert': [1100, 2900], 'harmony': [550, 2670],
  'blaine county': [1500, 4200], 'chumash': [-3160, 1000], 'banham canyon': [-2900, 500],
  'tataviam mountains': [2300, -300], 'richman': [-1380, 320], 'morningwood': [-1400, -170],
  'vinewood hills': [-150, 900], 'vinewood': [300, 180], 'burton': [-580, -140],
  'rockford hills': [-900, -200], 'downtown los santos': [-50, -650], 'mirror park': [1100, -650],
  'del perro': [-1600, -650], 'vespucci': [-1150, -1150], 'vespucci beach': [-1400, -1400],
  'little seoul': [-650, -900], 'pillbox hill': [60, -900], 'strawberry': [100, -1450],
  'davis': [150, -1750], 'chamberlain hills': [-150, -1550], 'la mesa': [750, -1000],
  'el burro heights': [1400, -1600], 'cypress flats': [850, -2100], 'murrieta heights': [1050, -850],
  'rancho': [400, -1900], 'port of los santos': [150, -2750], 'la puerta': [-500, -1700],
  'fort zancudo': [-2200, 3050], 'route 68': [300, 2650], 'humane labs': [3600, 3700],
  'legion square': [200, -930], 'textile city': [420, -990], 'hawick': [280, -450],
  'alta': [350, -700], 'east vinewood': [700, -150], 'del perro pier': [-1850, -1250],
  'elysian island': [250, -2780], 'terminal': [1050, -2900], 'palomino highlands': [2450, -1000],
  'great chaparral': [-400, 2850], 'stab city': [85, 3660], 'grape seed': [1680, 4750],
  'north chumash': [-3000, 2600], 'galilee': [1400, 4300],
}

/** Normalize an `area` string: trim, lowercase, strip a trailing ".0" on
 *  bare numbers (legacy imports store postal "21.0") — HeatmapView's `norm`
 *  plus lowercasing. */
export function normalizeArea(area: string | null | undefined): string {
  return String(area ?? '').replace(/(\d)\.0\b/g, '$1').trim().toLowerCase()
}

export interface ResolvedArea {
  /** Which lookup matched — postal codes are precise, named areas fuzzy. */
  source: 'postal' | 'area'
  /** Game coordinates (metres) — feed to gameToLngLat / gameToPixel. */
  x: number
  y: number
}

/** Resolve an area string to game coordinates, or null → "unplaced"
 *  (unrecognized names, custom-island areas like Roxwood, blank values). */
export function resolveArea(area: string | null | undefined): ResolvedArea | null {
  const norm = normalizeArea(area)
  if (!norm) return null
  if (/^\d{1,5}$/.test(norm)) {
    const postal = POSTALS.get(norm)
    return postal ? { source: 'postal', x: postal.x, y: postal.y } : null
  }
  const named = AREA_XY[norm]
  return named ? { source: 'area', x: named[0], y: named[1] } : null
}
