'use client'

/** Zoomable chronology band for the case Timeline tab. Events sit on one
 *  lane per type over a horizontal time scale; scroll to zoom around the
 *  cursor, drag to pan, hover a dot for details. Pure SVG over the same
 *  rows the list below renders — no extra fetching. The viewBox is fixed
 *  (no SVG-scale zoom) so text and dots never distort; zoom/pan only move
 *  the time→x mapping, mirroring the heatmap's functional-setState wheel
 *  and drag pattern. */
import { useEffect, useMemo, useRef, useState } from 'react'

export interface BandEvent {
  at: string
  label: string
  sub?: string
  type: 'opened' | 'followup' | 'evidence' | 'report' | 'task' | 'signoff'
}

const LANES: { type: BandEvent['type']; label: string; color: string }[] = [
  { type: 'opened',   label: 'Case',      color: '#3b82f6' },
  { type: 'followup', label: 'Follow-up', color: '#f59e0b' },
  { type: 'evidence', label: 'Evidence',  color: '#059669' },
  { type: 'report',   label: 'Reports',   color: '#8b5cf6' },
  { type: 'task',     label: 'Tasks',     color: '#22d3ee' },
  { type: 'signoff',  label: 'Sign-off',  color: '#fb7185' },
]

const W = 900          // fixed viewBox width — zoom never rescales the SVG
const LANE_H = 30
const AXIS_H = 26
const LABEL_W = 84     // left gutter for lane labels
const WORLD = 1000     // normalized time-world span
const GRID = '#1b2940'

const DAY = 86_400_000

interface Tip { x: number; y: number; label: string; sub?: string; at: string }

export function TimelineBand({ events }: { events: BandEvent[] }) {
  const [vb, setVb] = useState({ x: 0, w: WORLD })
  const [panning, setPanning] = useState(false)
  const [tip, setTip] = useState<Tip | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ px: number; moved: boolean } | null>(null)

  const m = useMemo(() => {
    const times = events.map((e) => new Date(e.at).getTime()).filter((t) => Number.isFinite(t))
    // No usable timestamps (incl. the initial empty render before data
    // arrives): pin a finite window — Math.min() of nothing is Infinity,
    // which sent the tick loop below spinning forever.
    const rawMin = times.length ? Math.min(...times) : 0
    const rawMax = times.length ? Math.max(...times) : 0
    const rawSpan = Math.max(rawMax - rawMin, DAY) // degenerate single-moment case
    const min = rawMin - rawSpan * 0.05
    const span = rawSpan * 1.1
    const lanes = LANES.filter((l) => events.some((e) => e.type === l.type))
    const laneY = new Map(lanes.map((l, i) => [l.type, i * LANE_H + LANE_H / 2 + 4]))
    return { min, span, lanes, laneY, h: lanes.length * LANE_H + 8 + AXIS_H }
  }, [events])

  // time → screen x for the current zoom window
  const sx = (t: number) => {
    const world = ((t - m.min) / m.span) * WORLD
    return LABEL_W + ((world - vb.x) / vb.w) * (W - LABEL_W)
  }

  // Visible-range axis ticks: pick the step that yields 4–10 labels.
  const ticks = useMemo(() => {
    const visSpan = (vb.w / WORLD) * m.span
    const steps = [3_600_000, 6 * 3_600_000, DAY, 2 * DAY, 7 * DAY, 14 * DAY, 30 * DAY, 91 * DAY, 182 * DAY, 365 * DAY]
    const step = steps.find((s) => visSpan / s <= 10) ?? steps[steps.length - 1]
    const visMin = m.min + (vb.x / WORLD) * m.span
    const out: { t: number; label: string }[] = []
    if (!Number.isFinite(visMin) || !Number.isFinite(visSpan)) return out
    for (let t = Math.ceil(visMin / step) * step; t <= visMin + visSpan && out.length < 40; t += step) {
      const d = new Date(t)
      out.push({
        t,
        label: step < DAY
          ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
          : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      })
    }
    return out
  }, [vb, m])

  // Wheel zoom must preventDefault (stop page scroll) → non-passive native
  // listener; all math inside functional setVb so the closure never staleness.
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const frac = Math.min(1, Math.max(0, (e.clientX - rect.left - (LABEL_W / W) * rect.width) / ((1 - LABEL_W / W) * rect.width)))
      const dir = e.deltaY > 0 ? 1.25 : 0.8
      setVb((v) => {
        const w = Math.min(WORLD, Math.max(4, v.w * dir))
        const anchor = v.x + frac * v.w
        const x = Math.min(Math.max(0, anchor - frac * w), WORLD - w)
        return { x, w }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const zoom = (dir: number) =>
    setVb((v) => {
      const w = Math.min(WORLD, Math.max(4, v.w * dir))
      const anchor = v.x + v.w / 2
      const x = Math.min(Math.max(0, anchor - w / 2), WORLD - w)
      return { x, w }
    })

  const showTip = (e: React.MouseEvent, ev: BandEvent) => {
    const host = (e.currentTarget as Element).closest('[data-band]')
    if (!host) return
    const r = host.getBoundingClientRect()
    setTip({
      x: Math.min(e.clientX - r.left, r.width - 170),
      y: e.clientY - r.top - 10,
      label: ev.label,
      sub: ev.sub,
      at: new Date(ev.at).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }),
    })
  }

  if (events.length < 2) return null

  return (
    <div data-band className="relative mb-4 overflow-hidden rounded-2xl border border-white/10 bg-ink-950/50">
      <div className="flex items-center justify-between px-3 pt-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Chronology — scroll to zoom, drag to pan</p>
        <div className="flex gap-1">
          <BandBtn label="Zoom in" onClick={() => zoom(0.8)}>+</BandBtn>
          <BandBtn label="Zoom out" onClick={() => zoom(1.25)}>−</BandBtn>
          <BandBtn label="Reset view" onClick={() => setVb({ x: 0, w: WORLD })}>⌂</BandBtn>
        </div>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${m.h}`}
        className={`block w-full touch-none select-none ${panning ? 'cursor-grabbing' : 'cursor-grab'}`}
        role="img"
        aria-label="Case chronology band"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { px: e.clientX, moved: false }
          setPanning(true)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const dx = e.clientX - d.px
          if (Math.abs(dx) > 3) d.moved = true
          d.px = e.clientX
          const rect = e.currentTarget.getBoundingClientRect()
          const pxPlot = rect.width * (1 - LABEL_W / W)
          setVb((v) => {
            const x = Math.min(Math.max(0, v.x - (dx / pxPlot) * v.w), WORLD - v.w)
            return { x, w: v.w }
          })
        }}
        onPointerUp={() => { drag.current = null; setPanning(false) }}
        onPointerLeave={() => { drag.current = null; setPanning(false) }}
      >
        {/* axis grid + tick labels */}
        {ticks.map((tk) => {
          const x = sx(tk.t)
          if (x < LABEL_W || x > W) return null
          return (
            <g key={tk.t}>
              <line x1={x} y1={4} x2={x} y2={m.h - AXIS_H + 6} stroke={GRID} strokeWidth={1} />
              <text x={x} y={m.h - 8} textAnchor="middle" fontSize={9.5} fill="#64748b">{tk.label}</text>
            </g>
          )
        })}

        {/* lanes */}
        {m.lanes.map((l) => {
          const y = m.laneY.get(l.type)!
          return (
            <g key={l.type}>
              <line x1={LABEL_W} y1={y} x2={W} y2={y} stroke={GRID} strokeWidth={1} strokeDasharray="2 4" />
              <circle cx={10} cy={y} r={3.5} fill={l.color} />
              <text x={19} y={y + 3.5} fontSize={10} fontWeight={600} fill="#94a3b8">{l.label}</text>
            </g>
          )
        })}

        {/* events */}
        {events.map((ev, i) => {
          const t = new Date(ev.at).getTime()
          if (!Number.isFinite(t)) return null
          const x = sx(t)
          if (x < LABEL_W - 6 || x > W + 6) return null
          const y = m.laneY.get(ev.type)
          if (y === undefined) return null
          const color = LANES.find((l) => l.type === ev.type)?.color ?? '#94a3b8'
          return (
            <circle
              key={`${ev.at}-${i}`}
              cx={x}
              cy={y}
              r={5}
              fill={color}
              stroke="#070b14"
              strokeWidth={1.5}
              onMouseEnter={(e) => showTip(e, ev)}
              onMouseLeave={() => setTip(null)}
            />
          )
        })}
      </svg>

      {tip && (
        <div className="pointer-events-none absolute z-10 max-w-[170px] -translate-y-full rounded-lg border border-white/10 bg-ink-900 px-2.5 py-1.5 shadow-xl" style={{ left: tip.x, top: tip.y }}>
          <p className="truncate text-xs font-semibold text-white">{tip.label}</p>
          {tip.sub && <p className="truncate text-[11px] text-slate-400">{tip.sub}</p>}
          <p className="text-[11px] text-slate-500">{tip.at}</p>
        </div>
      )}
    </div>
  )
}

function BandBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-xs font-bold text-slate-300 transition hover:bg-white/10"
    >
      {children}
    </button>
  )
}
