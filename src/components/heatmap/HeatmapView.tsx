'use client'

/** Commander Heatmap — port of vanilla heatmap.js. Aggregates LIVE data by
 *  area: case concentration (cases.area), gang turf (hotspot_area/block),
 *  criminal places (places.area), raid sites (raid_compensations → case
 *  area). Bureau isolation is automatic — cases/raids are RLS-scoped to the
 *  viewer; shared intel (turf/places) is division-wide by design. Layers
 *  re-weight the score live; a created_at slider windows the data.
 *
 *  Beyond vanilla: top-3 hotspot strip, per-area trend vs the previous
 *  equal-length window, and click-to-drill-down (tile or map dot) listing
 *  the underlying records with case deep-links. */
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Tables } from '@/lib/database.types'
import { list } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { caseStatusTint } from '@/lib/signoff'

type CaseRow = Tables<'cases'>
type PlaceRow = Tables<'places'>
type TurfRow = Tables<'gang_turf'>
type RaidRow = Tables<'raid_compensations'>
type GangRow = Tables<'gangs'>

const LAYER_META = [
  { key: 'cases', icon: '📂', label: 'Cases', w: 3 },
  { key: 'raids', icon: '💥', label: 'Raids', w: 3 },
  { key: 'turf', icon: '🚩', label: 'Turf', w: 2 },
  { key: 'places', icon: '📍', label: 'Places', w: 1 },
] as const
type LayerKey = (typeof LAYER_META)[number]['key']

const WINDOWS = [
  { label: 'All time', days: null },
  { label: 'Past year', days: 365 },
  { label: 'Past 90 days', days: 90 },
  { label: 'Past 30 days', days: 30 },
  { label: 'Past 7 days', days: 7 },
]

/** Known-area map positions on the stylized SA silhouette (viewBox 0 0 100 130). */
const HM_XY: Record<string, [number, number]> = {
  'paleto bay': [30, 10], 'mount chiliad': [40, 20], 'grapeseed': [57, 20], 'sandy shores': [55, 32],
  'grand senora desert': [47, 43], 'harmony': [37, 41], 'blaine county': [62, 28], 'chumash': [13, 58],
  'banham canyon': [18, 64], 'tataviam mountains': [68, 55], 'richman': [28, 72], 'morningwood': [24, 77],
  'vinewood hills': [42, 66], 'vinewood': [46, 73], 'burton': [39, 78], 'rockford hills': [32, 79],
  'downtown los santos': [49, 80], 'mirror park': [58, 76], 'del perro': [20, 80], 'vespucci': [23, 86],
  'vespucci beach': [18, 89], 'little seoul': [34, 85], 'pillbox hill': [47, 85], 'strawberry': [46, 91],
  'davis': [51, 95], 'chamberlain hills': [41, 93], 'la mesa': [58, 85], 'el burro heights': [66, 87],
  'cypress flats': [62, 93], 'murrieta heights': [62, 81], 'rancho': [54, 96], 'port of los santos': [55, 104],
  'la puerta': [36, 93], 'fort zancudo': [22, 40], 'route 68': [40, 48], 'humane labs': [72, 44],
  'legion square': [46, 83], 'textile city': [50, 87], 'hawick': [50, 76], 'alta': [51, 79],
  'east vinewood': [53, 74], 'del perro pier': [16, 84], 'elysian island': [58, 100],
  'terminal': [61, 98], 'palomino highlands': [72, 78], 'great chaparral': [30, 55],
  'stab city': [48, 30], 'grape seed': [57, 20], 'north chumash': [12, 48], 'galilee': [60, 26],
}

/** Strip a trailing ".0" on bare numbers (legacy imports: postal "21.0"). */
const norm = (s: string | null | undefined) => String(s ?? '').replace(/(\d)\.0\b/g, '$1').trim()

interface AreaRow {
  area: string
  v: Record<LayerKey, number>
  score: number
  /** Weighted score in the previous equal-length window; null on "All time". */
  prev: number | null
}

export function HeatmapView() {
  const { state } = useAuth()
  const [data, setData] = useState<{ cases: CaseRow[]; places: PlaceRow[]; turf: TurfRow[]; raids: RaidRow[]; gangs: GangRow[] }>({ cases: [], places: [], turf: [], raids: [], gangs: [] })
  const [loading, setLoading] = useState(true)
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({ cases: true, raids: true, turf: true, places: true })
  const [win, setWin] = useState(0)
  const [winPreview, setWinPreview] = useState(0)
  const [sel, setSel] = useState<string | null>(null)
  // "Now" is stamped per data load (not read inside the memo) so the window
  // cutoff stays deterministic for a given dataset — and lint-pure.
  const [loadedAt, setLoadedAt] = useState(0)

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    await Promise.resolve()
    setLoading(true)
    try {
      const [cases, places, turf, raids, gangs] = await Promise.all([
        list('cases', {}).catch(() => [] as CaseRow[]),
        list('places', {}).catch(() => [] as PlaceRow[]),
        list('gang_turf', {}).catch(() => [] as TurfRow[]),
        list('raid_compensations', {}).catch(() => [] as RaidRow[]),
        list('gangs', {}).catch(() => [] as GangRow[]),
      ])
      setData({ cases, places, turf, raids, gangs })
      setLoadedAt(Date.now())
    } finally { setLoading(false) }
  }, [state])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh])

  const enabled = LAYER_META.filter((L) => layers[L.key])

  const rows = useMemo<AreaRow[]>(() => {
    const days = WINDOWS[win].days
    const cutoff = days && loadedAt ? loadedAt - days * 86400000 : null
    const prevCutoff = cutoff && days ? cutoff - days * 86400000 : null
    const caseArea: Record<string, string> = {}
    for (const c of data.cases) caseArea[c.id] = norm(c.area)

    // One aggregation pass per window (current + previous) with shared logic.
    const aggregate = (from: number | null, to: number | null) => {
      const within = (createdAt: string | null | undefined) => {
        if (!createdAt) return to === null // undated rows count only in the open-ended current window
        const t = Date.parse(createdAt)
        return (from === null || t >= from) && (to === null || t < to)
      }
      const areas: Record<string, Record<LayerKey, number>> = {}
      const bump = (area: string | null | undefined, key: LayerKey) => {
        const a = norm(area)
        if (!a) return
        const v = (areas[a] = areas[a] ?? { cases: 0, places: 0, turf: 0, raids: 0 })
        v[key] += 1
      }
      if (layers.cases) data.cases.filter((c) => within(c.created_at)).forEach((c) => bump(c.area, 'cases'))
      if (layers.places) data.places.filter((p) => within(p.created_at)).forEach((p) => bump(p.area, 'places'))
      if (layers.turf) data.turf.filter((t) => within(t.created_at)).forEach((t) => bump(t.hotspot_area || t.block, 'turf'))
      if (layers.raids) data.raids.filter((r) => within(r.created_at)).forEach((r) => { const a = r.case_id ? caseArea[r.case_id] : ''; if (a) bump(a, 'raids') })
      return areas
    }

    const score = (v: Record<LayerKey, number>) => enabled.reduce((s, L) => s + v[L.key] * L.w, 0)
    const current = aggregate(cutoff, null)
    const previous = cutoff ? aggregate(prevCutoff, cutoff) : null
    return Object.entries(current)
      .map(([area, v]) => ({ area, v, score: score(v), prev: previous ? score(previous[area] ?? { cases: 0, places: 0, turf: 0, raids: 0 }) : null }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `enabled` derives from `layers`
  }, [data, layers, win, loadedAt])

  const max = rows.reduce((m, r) => Math.max(m, r.score), 0) || 1

  if (state !== 'in') return <Notice text="Sign in to view the Commander Heatmap." />

  return (
    <div>
      <div className="mb-4 rounded-2xl border border-white/5 bg-ink-900/60 p-5">
        <div className="flex flex-wrap items-center gap-2">
          {LAYER_META.map((L) => (
            <button
              key={L.key}
              aria-pressed={layers[L.key]}
              onClick={() => setLayers((prev) => ({ ...prev, [L.key]: !prev[L.key] }))}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${layers[L.key] ? 'border-blue-500/40 bg-blue-500/15 text-white' : 'border-white/10 bg-white/5 text-slate-500'}`}
            >
              {L.icon} {L.label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex w-full items-center gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Window</span>
          <input
            type="range" min={0} max={WINDOWS.length - 1} step={1} value={winPreview}
            onChange={(e) => setWinPreview(Number(e.target.value))}
            onMouseUp={() => setWin(winPreview)}
            onTouchEnd={() => setWin(winPreview)}
            onKeyUp={() => setWin(winPreview)}
            aria-label="Time window"
            className="h-1.5 flex-1 cursor-pointer accent-blue-500"
          />
          <span className="min-w-[6.5rem] text-right text-xs font-medium text-slate-200">{WINDOWS[winPreview].label}</span>
        </div>
      </div>

      {loading ? (
        <Notice text="Loading heatmap data…" />
      ) : !enabled.length ? (
        <Notice text="No layers selected — enable at least one layer above." />
      ) : !rows.length ? (
        <Notice text="No area data in this window. Widen the time range, enable more layers, or add an Area to cases, places, or gang turf." />
      ) : (
        <>
          {rows.length > 1 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {rows.slice(0, 3).map((r, i) => (
                <button key={r.area} onClick={() => setSel(r.area)} className="flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-left transition hover:bg-amber-500/10">
                  <span className="text-lg" aria-hidden>{['🥇', '🥈', '🥉'][i]}</span>
                  <span>
                    <span className="block text-sm font-bold text-white">{r.area}</span>
                    <span className="text-[11px] text-amber-200/80">intensity {Math.round((r.score / max) * 100)}<Trend r={r} /></span>
                  </span>
                </button>
              ))}
            </div>
          )}
          <HeatSvg rows={rows} max={max} layers={layers} onPick={setSel} />
          {sel && <AreaDetail area={sel} data={data} win={win} loadedAt={loadedAt} onClose={() => setSel(null)} />}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((r) => {
              const pct = Math.round((r.score / max) * 100)
              const lvl = pct >= 75 ? 'lvl3' : pct >= 50 ? 'lvl2' : pct >= 25 ? 'lvl1' : ''
              return (
                <button key={r.area} onClick={() => setSel(r.area)} className={`hm-tile ${lvl} block w-full text-left transition hover:brightness-110`} aria-label={`Show ${r.area} details`}>
                  <div className="flex items-center justify-between"><h4 className="text-base font-bold text-white">{r.area}</h4><span className="font-mono text-lg font-bold text-white">{pct}<Trend r={r} /></span></div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-ink-900"><div className="hm-bar" style={{ width: `${pct}%` }} /></div>
                  <div className="mt-3 grid grid-cols-2 gap-1 text-[11px] text-slate-300">
                    {enabled.map((L) => <span key={L.key}>{L.icon} {r.v[L.key]} {L.label.toLowerCase()}</span>)}
                  </div>
                </button>
              )
            })}
          </div>
          <p className="mt-4 text-[11px] text-slate-500">
            Intensity = {enabled.map((L) => `${L.label.toLowerCase()}×${L.w}`).join(' + ')}. Window:{' '}
            <span className="text-slate-300">{WINDOWS[win].label}</span> (by creation date). Scoped to cases you can
            access (bureau + JTF + grants). {rows.length} area{rows.length === 1 ? '' : 's'}. Click an area for its
            records{WINDOWS[win].days ? '; ▲▼ compare with the preceding window of the same length' : ''}.
          </p>
        </>
      )}
    </div>
  )
}

/** ▲ rising / ▼ cooling vs the previous equal-length window (windowed views only). */
function Trend({ r }: { r: AreaRow }) {
  if (r.prev === null) return null
  const d = r.score - r.prev
  if (!d) return <span className="ml-1 text-[11px] font-semibold text-slate-500" title="No change vs previous window">＝</span>
  return d > 0
    ? <span className="ml-1 text-[11px] font-semibold text-rose-300" title={`Up ${d} vs previous window`}>▲{d}</span>
    : <span className="ml-1 text-[11px] font-semibold text-emerald-300" title={`Down ${-d} vs previous window`}>▼{-d}</span>
}

/** Drill-down: the records behind one area in the active window. */
function AreaDetail({ area, data, win, loadedAt, onClose }: {
  area: string
  data: { cases: CaseRow[]; places: PlaceRow[]; turf: TurfRow[]; raids: RaidRow[]; gangs: GangRow[] }
  win: number
  loadedAt: number
  onClose: () => void
}) {
  const days = WINDOWS[win].days
  const cutoff = days && loadedAt ? loadedAt - days * 86400000 : null
  const inWin = (createdAt: string | null | undefined) => !cutoff || !createdAt || Date.parse(createdAt) >= cutoff
  const a = area.toLowerCase()
  const match = (s: string | null | undefined) => norm(s).toLowerCase() === a

  const cases = data.cases.filter((c) => match(c.area) && inWin(c.created_at))
  const caseById = new Map(data.cases.map((c) => [c.id, c]))
  const raids = data.raids.filter((r) => { const c = r.case_id ? caseById.get(r.case_id) : null; return c && match(c.area) && inWin(r.created_at) })
  const turf = data.turf.filter((t) => match(t.hotspot_area || t.block) && inWin(t.created_at))
  const places = data.places.filter((p) => match(p.area) && inWin(p.created_at))
  const gangName = (id: string | null) => (id && data.gangs.find((g) => g.id === id)?.name) || 'Unknown gang'

  return (
    <div className="mb-6 rounded-2xl border border-blue-500/20 bg-ink-900/70 p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-base font-bold text-white">📌 {area} <span className="ml-1 text-xs font-medium text-slate-500">{WINDOWS[win].label}</span></h3>
        <button onClick={onClose} aria-label="Close area details" className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs font-semibold text-slate-300 hover:bg-white/10">✕ Close</button>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <DetailBlock title={`📂 Cases (${cases.length})`}>
          {cases.map((c) => (
            <Link key={c.id} href={`/cases?case=${encodeURIComponent(c.id)}`} className="flex items-center gap-2 rounded border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-sm hover:border-blue-300/30">
              <span className="font-mono text-xs font-bold text-blue-300">{c.case_number}</span>
              <span className="min-w-0 flex-1 truncate text-slate-200">{c.title || 'Untitled'}</span>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-black uppercase ${caseStatusTint(c.status)}`}>{c.status}</span>
            </Link>
          ))}
        </DetailBlock>
        <DetailBlock title={`💥 Raids (${raids.length})`}>
          {raids.map((r) => {
            const c = r.case_id ? caseById.get(r.case_id) : null
            return (
              <Link key={r.id} href={c ? `/cases?case=${encodeURIComponent(c.id)}` : '/cases'} className="flex items-center gap-2 rounded border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-sm hover:border-blue-300/30">
                <span className="font-mono text-xs font-bold text-blue-300">{c?.case_number ?? 'Case'}</span>
                <span className="min-w-0 flex-1 truncate text-slate-200">Raid — net ${Number(r.net_value ?? 0).toLocaleString('en-US')}</span>
              </Link>
            )
          })}
        </DetailBlock>
        <DetailBlock title={`🚩 Turf (${turf.length})`}>
          {turf.map((t) => (
            <div key={t.id} className="rounded border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-sm text-slate-200">
              {t.block}{t.hotspot_area ? ` · ${t.hotspot_area}` : ''} — <span className="text-rose-300">{gangName(t.gang_id)}</span>
              <span className="ml-1 text-[10px] uppercase text-slate-500">{t.density} density</span>
            </div>
          ))}
        </DetailBlock>
        <DetailBlock title={`📍 Places (${places.length})`}>
          {places.map((p) => (
            <div key={p.id} className="rounded border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-sm text-slate-200">
              {p.name} <span className="text-[10px] uppercase text-slate-500">{p.type}</span>
              {p.controlling_gang_id && <span className="ml-1 text-xs text-rose-300">· {gangName(p.controlling_gang_id)}</span>}
            </div>
          ))}
        </DetailBlock>
      </div>
    </div>
  )
}

function DetailBlock({ title, children }: { title: string; children: React.ReactNode[] }) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-black uppercase tracking-wide text-slate-400">{title}</h4>
      <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
        {children.length ? children : <p className="text-sm text-slate-600">None in this window.</p>}
      </div>
    </div>
  )
}

function HeatSvg({ rows, max, layers, onPick }: { rows: AreaRow[]; max: number; layers: Record<LayerKey, boolean>; onPick: (area: string) => void }) {
  // Pan/zoom via viewBox math — self-contained vector map, no tiles, no CSP
  // changes. Wheel zooms on the cursor, drag pans, buttons cover touch.
  const HOME = { x: 0, y: 0, w: 100, h: 130 }
  const [vb, setVb] = useState(HOME)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ px: number; py: number; vb: typeof HOME; moved: boolean } | null>(null)
  const movedRef = useRef(false)
  const [panning, setPanning] = useState(false)

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    setVb((v) => {
      const w = Math.min(140, Math.max(12, v.w * factor))
      const h = w * (HOME.h / HOME.w)
      const fx = cx ?? v.x + v.w / 2
      const fy = cy ?? v.y + v.h / 2
      const kx = (fx - v.x) / v.w
      const ky = (fy - v.y) / v.h
      return { x: fx - kx * w, y: fy - ky * h, w, h }
    })
  }, [HOME.h, HOME.w])

  // Wheel must be a non-passive native listener to preventDefault page scroll.
  // All math runs inside the functional setVb, so the listener never closes
  // over stale viewBox state.
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const factor = e.deltaY > 0 ? 1.15 : 0.87
      setVb((v) => {
        const w = Math.min(140, Math.max(12, v.w * factor))
        const h = w * (130 / 100)
        const cx = v.x + ((e.clientX - r.left) / r.width) * v.w
        const cy = v.y + ((e.clientY - r.top) / r.height) * v.h
        const kx = (cx - v.x) / v.w
        const ky = (cy - v.y) / v.h
        return { x: cx - kx * w, y: cy - ky * h, w, h }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    drag.current = { px: e.clientX, py: e.clientY, vb, moved: false }
    movedRef.current = false
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    const el = svgRef.current
    if (!d || !el) return
    const r = el.getBoundingClientRect()
    const dx = ((e.clientX - d.px) / r.width) * d.vb.w
    const dy = ((e.clientY - d.py) / r.height) * d.vb.h
    if (Math.abs(e.clientX - d.px) + Math.abs(e.clientY - d.py) > 6) { d.moved = true; movedRef.current = true; setPanning(true) }
    if (d.moved) setVb({ ...d.vb, x: d.vb.x - dx, y: d.vb.y - dy })
  }
  const onPointerUp = () => { drag.current = null; setPanning(false) }
  const pick = (area: string) => { if (!movedRef.current) onPick(area) }

  const placed = rows.filter((r) => HM_XY[r.area.toLowerCase()])
  if (!placed.length) return null
  const unplaced = rows.length - placed.length
  const dotColor = (pct: number) => (pct >= 75 ? '#f43f5e' : pct >= 50 ? '#f59e0b' : '#3b82f6')
  const zoom = HOME.w / vb.w
  const fs = (base: number) => Math.max(base / Math.max(zoom, 1) ** 0.7, base * 0.35)
  const btn = 'grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-ink-900/90 text-sm font-black text-slate-200 hover:bg-white/10'

  return (
    <div className="relative mb-6 overflow-hidden rounded-2xl border border-white/5 bg-ink-950/60">
      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', maxHeight: 560, height: 'auto', display: 'block', touchAction: 'none', cursor: panning ? 'grabbing' : 'grab' }}
        role="img"
        aria-label="San Andreas intensity map — drag to pan, scroll to zoom"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {/* Ocean + landmass */}
        <rect x={-60} y={-60} width={220} height={250} fill="#070d1a" />
        <path d="M28,3 C45,1 62,6 68,14 C76,22 80,34 78,46 C86,54 88,66 84,78 C80,92 72,102 60,110 C52,116 40,118 30,112 C18,106 10,96 10,84 C6,72 8,60 14,50 C10,38 12,24 18,14 C21,8 24,5 28,3 Z" fill="#0f1726" stroke="#26385a" strokeWidth={0.8} />
        {/* Terrain tints: Chiliad forest, Senora desert, LS urban */}
        <ellipse cx={38} cy={18} rx={16} ry={11} fill="#14532d" opacity={0.14} />
        <ellipse cx={50} cy={40} rx={20} ry={13} fill="#b45309" opacity={0.10} />
        <ellipse cx={46} cy={88} rx={22} ry={15} fill="#475569" opacity={0.16} />
        {/* Alamo Sea + Zancudo river */}
        <path d="M44,26 C49,23 58,24 61,27 C63,30 60,34 54,34 C48,34 41,30 44,26 Z" fill="#123047" stroke="#26507a" strokeWidth={0.4} />
        <path d="M22,38 C19,42 16,45 13,49" fill="none" stroke="#123047" strokeWidth={1.1} strokeLinecap="round" />
        {/* Highways: Great Ocean Hwy, Route 68, Senora Fwy, LS loop */}
        <path d="M24,6 C16,16 12,28 12,40 C11,50 12,60 17,66 C20,72 19,78 20,84" fill="none" stroke="#33415588" strokeWidth={0.7} strokeDasharray="1.6 1" />
        <path d="M20,48 L70,45" fill="none" stroke="#33415588" strokeWidth={0.7} strokeDasharray="1.6 1" />
        <path d="M62,14 C60,28 58,44 55,60 C52,70 50,76 48,82" fill="none" stroke="#33415588" strokeWidth={0.7} strokeDasharray="1.6 1" />
        <path d="M30,84 C34,78 46,74 56,78 C64,82 66,90 60,96 C52,102 38,102 32,96 C28,92 28,88 30,84 Z" fill="none" stroke="#33415588" strokeWidth={0.7} strokeDasharray="1.6 1" />
        {/* Region labels */}
        <text x={30} y={7} fontSize={fs(3)} fill="#64748b">PALETO</text>
        <text x={60} y={38} fontSize={fs(3)} fill="#64748b">BLAINE COUNTY</text>
        <text x={40} y={104} fontSize={fs(3)} fill="#64748b">LOS SANTOS</text>
        <text x={46} y={31} fontSize={fs(2.2)} fill="#3b6186">ALAMO SEA</text>
        <text x={16} y={44} fontSize={fs(2.2)} fill="#64748b">ZANCUDO</text>
        {placed.map((r) => {
          const [x, y] = HM_XY[r.area.toLowerCase()]
          const pct = Math.round((r.score / max) * 100)
          const rad = (2 + (pct / 100) * 4.5) / Math.max(zoom, 1) ** 0.5
          const parts = LAYER_META.filter((L) => layers[L.key] && r.v[L.key]).map((L) => `${r.v[L.key]} ${L.label.toLowerCase()}`).join(', ')
          return (
            <g
              key={r.area}
              onClick={() => pick(r.area)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(r.area) } }}
              tabIndex={0}
              role="button"
              aria-label={`${r.area} — intensity ${pct}${parts ? ` (${parts})` : ''} — open records`}
              className="cursor-pointer focus:outline-none"
            >
              <circle cx={x} cy={y} r={rad.toFixed(2)} fill={dotColor(pct)} fillOpacity={0.75} stroke="#0b1120" strokeWidth={0.6 / Math.max(zoom, 1) ** 0.5}>
                <title>{r.area} — intensity {pct} ({parts}) — click for records</title>
              </circle>
              {/* The number rides along so intensity never depends on color alone. */}
              <text x={x} y={Number((y - rad - 1.5 / Math.max(zoom, 1) ** 0.5).toFixed(1))} textAnchor="middle" fontSize={fs(3.2)} fill="#cbd5e1">
                {r.area.length > 16 ? `${r.area.slice(0, 15)}…` : r.area} · {pct}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="absolute right-2 top-2 flex flex-col gap-1">
        <button className={btn} aria-label="Zoom in" onClick={() => zoomAt(0.75)}>+</button>
        <button className={btn} aria-label="Zoom out" onClick={() => zoomAt(1.33)}>−</button>
        <button className={btn} aria-label="Reset view" onClick={() => setVb(HOME)}>⌂</button>
      </div>
      <p className="border-t border-white/5 px-4 py-2 text-[11px] text-slate-500">
        Vector map — drag to pan, scroll or use +/− to zoom, click a dot (or Tab + Enter) for records. Each label carries
        the intensity number; size &amp; color repeat it:{' '}
        <span className="text-rose-300">● 75–100</span> · <span className="text-amber-300">● 50–74</span> ·{' '}
        <span className="text-blue-300">● 0–49</span>.
        {unplaced > 0 && ` ${unplaced} area${unplaced === 1 ? '' : 's'} without a map position (postals etc.) appear in the tiles below.`}
      </p>
    </div>
  )
}

function Notice({ text }: { text: string }) {
  return <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400">{text}</div>
}
