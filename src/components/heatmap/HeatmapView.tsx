'use client'

/** Commander Heatmap — port of vanilla heatmap.js. Aggregates LIVE data by
 *  area: case concentration (cases.area), gang turf (hotspot_area/block),
 *  criminal places (places.area), raid sites (raid_compensations → case
 *  area). Bureau isolation is automatic — cases/raids are RLS-scoped to the
 *  viewer; shared intel (turf/places) is division-wide by design. Layers
 *  re-weight the score live; a created_at slider windows the data. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Tables } from '@/lib/database.types'
import { list } from '@/lib/db'
import { useAuth } from '@/lib/auth'

type CaseRow = Tables<'cases'>
type PlaceRow = Tables<'places'>
type TurfRow = Tables<'gang_turf'>
type RaidRow = Tables<'raid_compensations'>

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
}

interface AreaRow { area: string; v: Record<LayerKey, number>; score: number }

export function HeatmapView() {
  const { state } = useAuth()
  const [data, setData] = useState<{ cases: CaseRow[]; places: PlaceRow[]; turf: TurfRow[]; raids: RaidRow[] }>({ cases: [], places: [], turf: [], raids: [] })
  const [loading, setLoading] = useState(true)
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({ cases: true, raids: true, turf: true, places: true })
  const [win, setWin] = useState(0)
  const [winPreview, setWinPreview] = useState(0)
  // "Now" is stamped per data load (not read inside the memo) so the window
  // cutoff stays deterministic for a given dataset — and lint-pure.
  const [loadedAt, setLoadedAt] = useState(0)

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    await Promise.resolve()
    setLoading(true)
    try {
      const [cases, places, turf, raids] = await Promise.all([
        list('cases', {}).catch(() => [] as CaseRow[]),
        list('places', {}).catch(() => [] as PlaceRow[]),
        list('gang_turf', {}).catch(() => [] as TurfRow[]),
        list('raid_compensations', {}).catch(() => [] as RaidRow[]),
      ])
      setData({ cases, places, turf, raids })
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
    const inWin = (createdAt: string | null | undefined) => !cutoff || !createdAt || Date.parse(createdAt) >= cutoff
    // Strip a trailing ".0" on bare numbers (legacy imports: postal "21.0").
    const norm = (s: string | null | undefined) => String(s ?? '').replace(/(\d)\.0\b/g, '$1').trim()
    const areas: Record<string, Record<LayerKey, number>> = {}
    const bump = (area: string | null | undefined, key: LayerKey) => {
      const a = norm(area)
      if (!a) return
      const v = (areas[a] = areas[a] ?? { cases: 0, places: 0, turf: 0, raids: 0 })
      v[key] += 1
    }
    const caseArea: Record<string, string> = {}
    for (const c of data.cases) caseArea[c.id] = norm(c.area)

    if (layers.cases) data.cases.filter((c) => inWin(c.created_at)).forEach((c) => bump(c.area, 'cases'))
    if (layers.places) data.places.filter((p) => inWin(p.created_at)).forEach((p) => bump(p.area, 'places'))
    if (layers.turf) data.turf.filter((t) => inWin(t.created_at)).forEach((t) => bump(t.hotspot_area || t.block, 'turf'))
    if (layers.raids) data.raids.filter((r) => inWin(r.created_at)).forEach((r) => { const a = r.case_id ? caseArea[r.case_id] : ''; if (a) bump(a, 'raids') })

    const score = (v: Record<LayerKey, number>) => enabled.reduce((s, L) => s + v[L.key] * L.w, 0)
    return Object.entries(areas)
      .map(([area, v]) => ({ area, v, score: score(v) }))
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
          <HeatSvg rows={rows} max={max} layers={layers} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((r) => {
              const pct = Math.round((r.score / max) * 100)
              const lvl = pct >= 75 ? 'lvl3' : pct >= 50 ? 'lvl2' : pct >= 25 ? 'lvl1' : ''
              return (
                <div key={r.area} className={`hm-tile ${lvl}`}>
                  <div className="flex items-center justify-between"><h4 className="text-base font-bold text-white">{r.area}</h4><span className="font-mono text-lg font-bold text-white">{pct}</span></div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-ink-900"><div className="hm-bar" style={{ width: `${pct}%` }} /></div>
                  <div className="mt-3 grid grid-cols-2 gap-1 text-[11px] text-slate-300">
                    {enabled.map((L) => <span key={L.key}>{L.icon} {r.v[L.key]} {L.label.toLowerCase()}</span>)}
                  </div>
                </div>
              )
            })}
          </div>
          <p className="mt-4 text-[11px] text-slate-500">
            Intensity = {enabled.map((L) => `${L.label.toLowerCase()}×${L.w}`).join(' + ')}. Window:{' '}
            <span className="text-slate-300">{WINDOWS[win].label}</span> (by creation date). Scoped to cases you can
            access (bureau + JTF + grants). {rows.length} area{rows.length === 1 ? '' : 's'}.
          </p>
        </>
      )}
    </div>
  )
}

function HeatSvg({ rows, max, layers }: { rows: AreaRow[]; max: number; layers: Record<LayerKey, boolean> }) {
  const placed = rows.filter((r) => HM_XY[r.area.toLowerCase()])
  if (!placed.length) return null
  const unplaced = rows.length - placed.length
  const dotColor = (pct: number) => (pct >= 75 ? '#f43f5e' : pct >= 50 ? '#f59e0b' : '#3b82f6')
  return (
    <div className="mb-6 overflow-hidden rounded-2xl border border-white/5 bg-ink-950/60">
      <svg viewBox="0 0 100 130" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', maxHeight: 520, height: 'auto', display: 'block' }} role="img" aria-label="San Andreas intensity map">
        <path d="M28,3 C45,1 62,6 68,14 C76,22 80,34 78,46 C86,54 88,66 84,78 C80,92 72,102 60,110 C52,116 40,118 30,112 C18,106 10,96 10,84 C6,72 8,60 14,50 C10,38 12,24 18,14 C21,8 24,5 28,3 Z" fill="#0f1726" stroke="#26385a" strokeWidth="0.8" />
        <text x="30" y="7" fontSize="3" fill="#64748b">PALETO</text>
        <text x="52" y="38" fontSize="3" fill="#64748b">BLAINE COUNTY</text>
        <text x="40" y="102" fontSize="3" fill="#64748b">LOS SANTOS</text>
        {placed.map((r) => {
          const [x, y] = HM_XY[r.area.toLowerCase()]
          const pct = Math.round((r.score / max) * 100)
          const rad = 2 + (pct / 100) * 4.5
          const parts = LAYER_META.filter((L) => layers[L.key] && r.v[L.key]).map((L) => `${r.v[L.key]} ${L.label.toLowerCase()}`).join(', ')
          return (
            <g key={r.area}>
              <circle cx={x} cy={y} r={rad.toFixed(1)} fill={dotColor(pct)} fillOpacity={0.75} stroke="#0b1120" strokeWidth={0.6}>
                <title>{r.area} — intensity {pct} ({parts})</title>
              </circle>
              <text x={x} y={Number((y - rad - 1.5).toFixed(1))} textAnchor="middle" fontSize="3.2" fill="#cbd5e1">
                {r.area.length > 16 ? `${r.area.slice(0, 15)}…` : r.area}
              </text>
            </g>
          )
        })}
      </svg>
      <p className="border-t border-white/5 px-4 py-2 text-[11px] text-slate-500">
        Stylized map — dot size &amp; color follow area intensity (hover a dot for the breakdown).
        {unplaced > 0 && ` ${unplaced} area${unplaced === 1 ? '' : 's'} without a map position (postals etc.) appear in the tiles below.`}
      </p>
    </div>
  )
}

function Notice({ text }: { text: string }) {
  return <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400">{text}</div>
}
