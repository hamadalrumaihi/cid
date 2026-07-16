'use client'

/** Relationship Network — port of vanilla network.js. Hand-rolled SVG
 *  ego/overview graph, no graph dependency: gangs are hubs; persons (members),
 *  places (turf/fronts) and narcotics (linked substances) orbit them. Click a
 *  node to re-centre (ego view); click the centred gang/person to open its
 *  intel profile. Drag to pan, wheel or +/− to zoom. `?focus=g:<id>|p:<id>|
 *  n:<id>` deep-links a centred node. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { Tables } from '@/lib/database.types'
import { list } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { IntelProfile, type IntelTarget } from '@/components/persons/IntelProfile'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Notice, EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'

type GangRow = Tables<'gangs'>

const FILL = { gang: '#3b82f6', person: '#10b981', place: '#f59e0b', narcotic: '#a78bfa' } as const
const RADIUS = { gang: 26, person: 16, place: 14, narcotic: 15 } as const
const ICON = { gang: '🚩', person: '👤', place: '📍', narcotic: '💊' } as const
const VBW = 1000
const VBH = 640

type NodeType = keyof typeof FILL
interface NetNode { key: string; type: NodeType; label: string; sub: string; id: string }
interface Graph { nodes: Record<string, NetNode>; adj: Record<string, Set<string>> }

const trunc = (s: string, n = 16) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '')

export function NetworkView() {
  const { state } = useAuth()
  const sp = useSearchParams()
  const [graph, setGraph] = useState<Graph | null>(null)
  const [gangs, setGangs] = useState<GangRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [focus, setFocus] = useState<string | null>(() => sp.get('focus'))
  const [view, setView] = useState({ tx: 0, ty: 0, k: 1 })
  const [profile, setProfile] = useState<IntelTarget | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef({ on: false, moved: false, sx: 0, sy: 0, stx: 0, sty: 0 })
  // Cursor is render state (refs can't be read during render); the drag
  // mechanics themselves stay in the ref to avoid re-rendering per move.
  const [dragging, setDragging] = useState(false)

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    await Promise.resolve()
    setErr(null)
    try {
      const safe = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[])
      const [gs, persons, places, members, narcotics, narcPlaces, narcGangs] = await Promise.all([
        safe(list('gangs', {})),
        safe(list('persons', {})),
        safe(list('places', {})),
        safe(list('gang_members', {})),
        safe(list('narcotics', {})),
        safe(list('narcotic_places', {})),
        safe(list('narcotic_gangs', {})),
      ])
      setGangs(gs)
      const nodes: Record<string, NetNode> = {}
      const adj: Record<string, Set<string>> = {}
      const add = (key: string, type: NodeType, label: string, sub: string) => {
        if (!nodes[key]) { nodes[key] = { key, type, label, sub, id: key.slice(key.indexOf(':') + 1) }; adj[key] = new Set() }
      }
      const link = (a: string, b: string) => { if (a !== b && nodes[a] && nodes[b]) { adj[a].add(b); adj[b].add(a) } }
      for (const g of gs) add(`g:${g.id}`, 'gang', g.name || 'Gang', g.threat_level ? `${cap(g.threat_level)} threat` : '')
      const personById = new Map(persons.map((p) => [p.id, p]))
      // Persons/places only enter when gang-linked — unaffiliated rows are noise here.
      for (const p of persons) {
        if (p.gang_id && nodes[`g:${p.gang_id}`]) { add(`p:${p.id}`, 'person', p.name || 'Person', p.alias || p.status || ''); link(`p:${p.id}`, `g:${p.gang_id}`) }
      }
      for (const m of members) {
        const p = m.person_id ? personById.get(m.person_id) : null
        if (p && m.gang_id && nodes[`g:${m.gang_id}`]) { add(`p:${p.id}`, 'person', p.name || 'Person', p.alias || p.status || ''); link(`p:${p.id}`, `g:${m.gang_id}`) }
      }
      const placeById = new Map(places.map((pl) => [pl.id, pl]))
      for (const pl of places) {
        if (pl.controlling_gang_id && nodes[`g:${pl.controlling_gang_id}`]) { add(`pl:${pl.id}`, 'place', pl.name || 'Place', ''); link(`pl:${pl.id}`, `g:${pl.controlling_gang_id}`) }
      }
      // Substances enter only via a real link-table row (Substance→Gang /
      // Substance→Place). Merged tombstones are excluded; unsourced text is not
      // a link, so nothing here is inferred.
      const narcById = new Map(narcotics.filter((n) => n.status !== 'merged').map((n) => [n.id, n]))
      const addNarc = (id: string) => {
        const n = narcById.get(id)
        if (!n) return false
        add(`n:${id}`, 'narcotic', n.name || 'Substance', n.category ? cap(n.category) : '')
        return true
      }
      for (const ng of narcGangs) {
        if (ng.narcotic_id && ng.gang_id && nodes[`g:${ng.gang_id}`] && addNarc(ng.narcotic_id)) link(`n:${ng.narcotic_id}`, `g:${ng.gang_id}`)
      }
      for (const np of narcPlaces) {
        if (!np.narcotic_id || !np.place_id) continue
        // Pull the linked place into the graph even if it isn't gang-controlled,
        // so the Substance→Place edge has both ends.
        if (!nodes[`pl:${np.place_id}`]) { const pl = placeById.get(np.place_id); if (pl) add(`pl:${pl.id}`, 'place', pl.name || 'Place', '') }
        if (nodes[`pl:${np.place_id}`] && addNarc(np.narcotic_id)) link(`n:${np.narcotic_id}`, `pl:${np.place_id}`)
      }
      setGraph({ nodes, adj })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [state])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh])

  // Deterministic layout: ego ring when focused; else gangs on a big circle
  // with satellites in small orbits.
  const layout = useMemo(() => {
    if (!graph) return null
    const { nodes, adj } = graph
    const pos: Record<string, { x: number; y: number }> = {}
    const visible = new Set<string>()
    const f = focus && nodes[focus] ? focus : null
    if (f) {
      pos[f] = { x: 0, y: 0 }; visible.add(f)
      const neigh = [...adj[f]].filter((k) => nodes[k])
      const n = neigh.length
      const R = Math.max(170, Math.min(300, 90 + n * 16))
      neigh.forEach((k, i) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(n, 1); pos[k] = { x: R * Math.cos(a), y: R * Math.sin(a) }; visible.add(k) })
    } else {
      const hubs = Object.values(nodes).filter((nd) => nd.type === 'gang')
      const ng = hubs.length
      const R = ng <= 1 ? 0 : Math.max(220, Math.min(430, 120 + ng * 40))
      hubs.forEach((gn, i) => {
        const ga = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(ng, 1)
        const gx = R * Math.cos(ga)
        const gy = R * Math.sin(ga)
        pos[gn.key] = { x: gx, y: gy }; visible.add(gn.key)
        const sat = [...adj[gn.key]].filter((k) => nodes[k] && !pos[k])
        const m = sat.length
        const r = Math.max(70, Math.min(150, 40 + m * 12))
        sat.forEach((k, j) => { const a = (2 * Math.PI * j) / Math.max(m, 1); pos[k] = { x: gx + r * Math.cos(a), y: gy + r * Math.sin(a) }; visible.add(k) })
      })
    }
    return { pos, visible, focus: f }
  }, [graph, focus])

  const zoomBy = (fac: number) => setView((v) => ({ tx: v.tx * fac, ty: v.ty * fac, k: Math.max(0.3, Math.min(3, v.k * fac)) }))
  const setFocusKey = (key: string | null) => { setFocus(key); setView({ tx: 0, ty: 0, k: 1 }) }

  const onNode = (key: string) => {
    if (drag.current.moved || !graph || !layout) return
    const nd = graph.nodes[key]
    if (key === layout.focus) {
      if (nd.type === 'gang' || nd.type === 'person') setProfile({ type: nd.type, id: nd.id })
      return
    }
    setFocusKey(key)
  }

  // Wheel zoom needs passive:false (preventDefault), so wire it natively.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1) }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [graph])

  if (state !== 'in') return <Notice text="Live relationship data requires sign-in." />
  if (err) return <ErrorNotice message={err} onRetry={refresh} />
  if (!graph || !layout) return <Notice text="Building network…" />
  if (!Object.keys(graph.nodes).length) return (
    <EmptyState
      icon="🕸️"
      title="No relationships on file yet"
      hint="Link persons or places to a gang, then revisit to see the network."
    />
  )

  const { nodes, adj } = graph
  const { pos, visible } = layout
  const focusNd = layout.focus ? nodes[layout.focus] : null

  // Edges deduped by sorted pair; nodes drawn on top.
  const drawn = new Set<string>()
  const edges: { a: string; b: string }[] = []
  visible.forEach((a) => adj[a].forEach((b) => {
    if (!visible.has(b)) return
    const key = a < b ? `${a}|${b}` : `${b}|${a}`
    if (drawn.has(key)) return
    drawn.add(key)
    edges.push({ a, b })
  }))

  const ratio = () => VBW / (svgRef.current?.clientWidth || VBW)

  return (
    <div>
      <Card pad="sm" className="mb-3">
        <PageHeader
          eyebrow="Relationship network"
          title={focusNd ? `${ICON[focusNd.type]} ${focusNd.label}` : 'Overview — all gangs & their networks'}
          subtitle={`${visible.size} node${visible.size === 1 ? '' : 's'} shown · click a node to re-centre${focusNd ? ' · click the centre to open its profile' : ''}`}
          actions={
            <>
              <span className="hidden items-center gap-3 text-[11px] text-slate-400 sm:flex">
                {(['gang', 'person', 'place', 'narcotic'] as const).map((t) => (
                  <span key={t} className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full" style={{ background: FILL[t] }} />{cap(t)}</span>
                ))}
              </span>
              {focusNd && (focusNd.type === 'gang' || focusNd.type === 'person') && (
                <button onClick={() => setProfile({ type: focusNd.type as 'gang' | 'person', id: focusNd.id })} className="-my-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-xs font-semibold text-blue-200 transition hover:bg-white/10">🔎 Profile</button>
              )}
              {layout.focus && <Button size="sm" className="-my-1" onClick={() => setFocusKey(null)}>⌂ Overview</Button>}
              <Button size="sm" className="-my-1" onClick={() => zoomBy(1.2)} aria-label="Zoom in">＋</Button>
              <Button size="sm" className="-my-1" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">－</Button>
              <Button size="sm" className="-my-1" onClick={() => setView({ tx: 0, ty: 0, k: 1 })} aria-label="Reset view">↺</Button>
            </>
          }
        />
      </Card>
      <div className="overflow-hidden rounded-2xl border border-white/5 bg-ink-950/60">
        <svg
          ref={svgRef}
          viewBox={`${-VBW / 2} ${-VBH / 2} ${VBW} ${VBH}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ width: '100%', height: 'auto', aspectRatio: `${VBW}/${VBH}`, touchAction: 'none', cursor: dragging ? 'grabbing' : 'grab', display: 'block' }}
          onPointerDown={(e) => { drag.current = { on: true, moved: false, sx: e.clientX, sy: e.clientY, stx: view.tx, sty: view.ty }; setDragging(true) }}
          onPointerMove={(e) => {
            const d = drag.current
            if (!d.on) return
            const dx = e.clientX - d.sx
            const dy = e.clientY - d.sy
            if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true
            const rr = ratio()
            setView((v) => ({ ...v, tx: d.stx + dx * rr, ty: d.sty + dy * rr }))
          }}
          onPointerUp={() => { drag.current.on = false; setDragging(false) }}
          onPointerCancel={() => { drag.current.on = false; setDragging(false) }}
          onPointerLeave={() => { drag.current.on = false; setDragging(false) }}
        >
          <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
            {edges.map(({ a, b }) => (
              <line key={`${a}|${b}`} x1={pos[a].x} y1={pos[a].y} x2={pos[b].x} y2={pos[b].y} stroke="#334155" strokeWidth={1.5} />
            ))}
            {[...visible].map((k) => {
              const nd = nodes[k]
              const p = pos[k]
              const r = RADIUS[nd.type]
              const isF = k === layout.focus
              return (
                <g key={k} style={{ cursor: 'pointer' }} onClick={() => onNode(k)}>
                  {isF && <circle cx={p.x} cy={p.y} r={r + 7} fill="none" stroke="#e2e8f0" strokeWidth={2} />}
                  <circle cx={p.x} cy={p.y} r={r} fill={FILL[nd.type]} fillOpacity={0.9} stroke="#0b1120" strokeWidth={2} />
                  <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={nd.type === 'gang' ? 15 : 12}>{ICON[nd.type]}</text>
                  <text x={p.x} y={p.y + r + 14} textAnchor="middle" fontSize={11} fill="#cbd5e1">{trunc(nd.label)}</text>
                </g>
              )
            })}
          </g>
        </svg>
      </div>
      {profile && <IntelProfile initial={profile} gangs={gangs} onClose={() => setProfile(null)} />}
    </div>
  )
}
