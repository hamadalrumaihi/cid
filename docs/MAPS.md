# Investigation Map — assets, coordinates, and the Roxwood plan

The investigation map (pilot: the Places registry's **List | Map** toggle) is
MapLibre GL JS over a **self-hosted** raster tile pyramid. Nothing loads from
external tile hosts at runtime — the CSP stays closed; the only CSP change the
map required is `worker-src 'self' blob:` (+ `child-src` fallback) because
MapLibre runs its tile parser in a blob-URL Web Worker (see `next.config.ts`).

## Vendored assets

| Asset | Path | Size | Source |
| --- | --- | --- | --- |
| Atlas tile pyramid, zooms 0–5, google scheme `{z}_{x}_{y}.jpg` | `public/map/atlas/` | ~24 MB, 1,365 tiles | [Flamm64/GTA-V-World-Map](https://github.com/Flamm64/GTA-V-World-Map) `Atlas/Atlas.7z` (by Zslash / Martin Floden) |
| Postal points (1,687 codes, 1000–10140, game coords) | `src/lib/map/postals.json` | 96 KB | [DevBlocky/nearest-postal](https://github.com/DevBlocky/nearest-postal) `new-postals.json` (MIT © 2019 BlockBa5her) |

Upstream ships zooms 0–7; z6 (+59 MB) and z7 (+264 MB) are deliberately **not**
vendored. The map caps at MapLibre zoom 6 and overzooms the z5 tiles, which is
plenty for area/postal-precision markers.

### License status — read before redistributing

- The `nearest-postal` **script** is MIT. The postal **coordinate data** is the
  community "New & Improved Postal Code Map v1.1" dataset (FiveM forum
  release) — game-derived.
- The Flamm64 artwork carries the author's permissive note ("you can edit,
  modify, share and republish as long as you modify it"; we re-tile / truncate
  the pyramid, i.e. a modification) — but it is **rendered from GTA V game
  files**. Like every community GTA map asset, it is *tolerated-but-unlicensed*
  by the IP holder (gray status).
- Usage here is a **private, login-gated RP-community portal** — the accepted
  norm for these assets. Do not ship them in a public commercial product.

## Coordinate model (`src/lib/map/coords.ts`)

`pixelX(z0) = 0.01255·gameX + 122.1`, `pixelY(z0) = −0.01255·gameY + 154.9`
(256 px zoom-0 world; ×2^z per zoom). The widely-copied fivem-leaflet affine
(0.02072/117.3/−0.0205/172.8) does **not** fit Zslash's render, so this fit was
self-calibrated by maximizing postal-on-road alignment across all 1,687 postal
points, then spot-verified: postal **8022** → Downtown LS, **7255** → Backlot
City (western LS), **1000** → Great Ocean Hwy at Procopio Beach (far north).
Unit tests pin those landmarks. Markers reach MapLibre through a standard
pseudo-mercator wrap (`pixelToLngLat`).

`src/lib/map/gazetteer.ts` resolves a record's free-text `area`:
exact postal code → precise point; one of the ~50 named areas (the Commander
Heatmap's HM_XY vocabulary, re-anchored to game coordinates) → approximate
point; anything else → `null` = **unplaced**.

## Roxwood & graceful degradation

The server's custom Roxwood island exists in **none** of these community
assets — no tiles, no postals, no named areas. By design its records resolve
to "unplaced": the map footer counts them ("N without a recognized map
position … shown in the list only") and the list view remains the complete
record. Nothing errors, nothing is hidden.

### Swapping in server-owner assets (incl. Roxwood)

1. **Artwork**: render/obtain the server's own map image, cut it into a
   google-scheme pyramid (e.g. `gdal2tiles` / the same photoshop tile cutter
   upstream used) and replace `public/map/atlas/` — keep the
   `{z}_{x}_{y}.jpg` naming, or update the one `tiles:` template in
   `src/components/map/InvestigationMap.tsx`.
2. **Recalibrate**: fit `GAME_TO_PX` in `src/lib/map/coords.ts` against the
   new render — two known game-coord anchors (or the postal-on-road optimizer
   described in the module header) are enough; the landmark unit tests in
   `coords.test.ts` will fail loudly until the constants are right.
3. **Postals**: if the server uses a custom postal set (Roxwood postals),
   replace `src/lib/map/postals.json` with it (same `{x, y, code}` shape).
4. **Named areas**: add Roxwood neighborhoods to `AREA_XY` in
   `gazetteer.ts` (game coords), and extend the gazetteer tests.
5. If the new world exceeds vanilla bounds, widen `GAME_BOUNDS` in
   `coords.ts` (pan constraints + fitBounds derive from it).

No component changes are needed: PlacesView (and any future map caller) only
passes `area` strings.
