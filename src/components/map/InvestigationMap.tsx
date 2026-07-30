'use client'

/** Shared investigation map — MapLibre GL over the self-hosted San Andreas
 *  atlas pyramid (public/map/atlas/, zooms 0–5; provenance + swap procedure
 *  in docs/MAPS.md). Callers pass records with a free-text `area`; the
 *  gazetteer resolves postal codes and named areas to game coordinates and
 *  anything unrecognized (blank areas, the still-unmapped Roxwood island)
 *  degrades to an "unplaced" count in the footer — never an error.
 *
 *  HEAVY MODULE — maplibre-gl is ~230 KB gzip. Import this file only through
 *  next/dynamic (the CaseGraphTab/React-Flow precedent) so it stays out of
 *  the route chunk until the user actually opens the map. The keyboard-
 *  friendly list stays the primary representation in every caller; the map
 *  is an optional second view (60-odd rows → plain markers, no clustering). */
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useMemo, useRef } from 'react'
import { gameToLngLat, mapBounds } from '@/lib/map/coords'
import { resolveArea } from '@/lib/map/gazetteer'

export interface MapItem {
  id: string
  name: string
  /** Short type label for the popup ("Drug Lab", "Stash House"…). */
  subtitle?: string
  /** Free-text area — postal code or neighborhood name; null → unplaced. */
  area: string | null
}

/** Ocean color sampled from the artwork so overzoom edges and any missing
 *  tile blend instead of flashing a dark void. */
const OCEAN = '#0fa8d2'

export function InvestigationMap({ items, onSelect, selectLabel = 'View in list' }: {
  items: MapItem[]
  /** Popup action ("View in list") — keeps deep-links out of the popup DOM. */
  onSelect?: (id: string) => void
  selectLabel?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])
  // The popup button calls the LATEST onSelect without re-running the marker
  // effect (callers pass inline closures that change identity every render).
  const onSelectRef = useRef(onSelect)
  useEffect(() => { onSelectRef.current = onSelect }, [onSelect])

  const placed = useMemo(
    () =>
      items.flatMap((item) => {
        const at = resolveArea(item.area)
        return at ? [{ item, lngLat: gameToLngLat(at.x, at.y), fuzzy: at.source === 'area' }] : []
      }),
    [items],
  )
  const unplaced = items.length - placed.length

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      // Inline style: one raster source over a flat ocean background. Tiles
      // are same-origin (public/map/atlas) — no external hosts, CSP stays
      // closed. Source maxzoom 5 = the deepest vendored level; MapLibre
      // overzooms those tiles up to map maxZoom 6.
      style: {
        version: 8,
        sources: {
          atlas: {
            type: 'raster',
            tiles: [`${window.location.origin}/map/atlas/{z}_{x}_{y}.jpg`],
            tileSize: 256,
            minzoom: 0,
            maxzoom: 5,
          },
        },
        layers: [
          { id: 'ocean', type: 'background', paint: { 'background-color': OCEAN } },
          { id: 'atlas', type: 'raster', source: 'atlas', paint: { 'raster-fade-duration': 0 } },
        ],
      },
      bounds: [gameToLngLat(-3500, -3600), gameToLngLat(3850, 6800)], // the island
      fitBoundsOptions: { padding: 16 },
      maxBounds: mapBounds(),
      maxZoom: 6,
      attributionControl: false,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(
      new maplibregl.AttributionControl({ compact: true, customAttribution: 'Community map art — Zslash (Flamm64/GTA-V-World-Map)' }),
    )
    mapRef.current = map
    return () => {
      mapRef.current = null
      map.remove()
    }
  }, [])

  // Marker layer — rebuilt when the (already filtered, RLS-visible) rows
  // change. All popup content is created via textContent, never HTML strings,
  // so DB-sourced names can't inject markup.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    markersRef.current.forEach((m) => m.remove())
    markersRef.current = placed.map(({ item, lngLat, fuzzy }) => {
      const el = document.createElement('button')
      el.type = 'button'
      el.className = 'inv-map-marker'
      el.setAttribute(
        'aria-label',
        `${item.name}${item.subtitle ? ` — ${item.subtitle}` : ''}${fuzzy ? ' (approximate area position)' : ''}`,
      )

      const content = document.createElement('div')
      const title = document.createElement('p')
      title.className = 'inv-map-popup-title'
      title.textContent = item.name
      content.appendChild(title)
      const meta = document.createElement('p')
      meta.className = 'inv-map-popup-meta'
      meta.textContent = [item.subtitle, item.area, fuzzy ? 'approximate' : null].filter(Boolean).join(' · ')
      content.appendChild(meta)
      if (onSelectRef.current) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'inv-map-popup-link'
        btn.textContent = `${selectLabel} →`
        btn.addEventListener('click', () => onSelectRef.current?.(item.id))
        content.appendChild(btn)
      }

      return new maplibregl.Marker({ element: el })
        .setLngLat(lngLat)
        .setPopup(new maplibregl.Popup({ offset: 14, className: 'inv-map-popup' }).setDOMContent(content))
        .addTo(map)
    })
  }, [placed, selectLabel])

  return (
    <div className="overflow-hidden rounded-2xl border border-white/5 bg-ink-950/60">
      <div ref={containerRef} className="h-[420px] w-full sm:h-[520px]" role="region" aria-label="San Andreas investigation map — drag to pan, scroll or use +/− to zoom" />
      <p className="border-t border-white/5 px-4 py-2 text-[11px] text-slate-400">
        {placed.length} of {items.length} plotted — postal codes place precisely, named areas approximately.
        {unplaced > 0 && (
          <span className="ml-1 text-amber-200/80">
            {unplaced} without a recognized map position (blank, off-map or Roxwood areas) — shown in the list only.
          </span>
        )}
        {' '}The list view remains the full, keyboard-first record.
      </p>
    </div>
  )
}
