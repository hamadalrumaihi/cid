'use client'

/** The Cytoscape canvas — the ONLY module that imports `cytoscape` and
 *  registers `cytoscape-fcose`. InvestigationGraph loads it through
 *  `next/dynamic` (ssr off), so nothing here reaches the shared first-load
 *  chunk. Presentational: it draws the elements it is given, applies the
 *  state classes (selected / dimmed / path / match), and reports taps. All
 *  data decisions (what to expand, what is visible) stay in the parent.
 *
 *  Layout is fcose; incremental (`randomize:false`) after the first run so
 *  an expansion grows the picture instead of reshuffling it. Layout never
 *  animates (a 300 ms reshuffle of 200 nodes is noise, and the shell honours
 *  reduced motion everywhere). Keyboard: + / − zoom, arrows pan, 0 fits. */
import cytoscape from 'cytoscape'
import fcose, { type FcoseLayoutOptions } from 'cytoscape-fcose'
import { useEffect, useRef } from 'react'
import type { GraphElement } from '@/lib/graphModel'

let registered = false
function ensureFcose(): void {
  if (registered) return
  cytoscape.use(fcose)
  registered = true
}

export interface GraphCanvasApi {
  zoomIn: () => void
  zoomOut: () => void
  fit: () => void
  /** PNG of the whole graph on the canvas background (scale 2). */
  png: () => Blob | null
  /** Current node positions by canvas id (rounded). */
  positions: () => Record<string, { x: number; y: number }>
  /** Re-run the force layout from scratch. */
  relayout: () => void
}

export interface GraphCanvasProps {
  elements: readonly GraphElement[]
  selectedId: string | null
  /** Ids to draw dimmed (focus mode). null → nothing dimmed. */
  dimmedIds: ReadonlySet<string> | null
  /** Node + edge ids on the highlighted path. */
  pathIds: ReadonlySet<string> | null
  /** Search matches — nodes NOT in the set fade. null → no search. */
  matchIds: ReadonlySet<string> | null
  /** Nodes picked as path endpoints (dashed ring). */
  pickIds: ReadonlySet<string>
  edgeLabels: boolean
  /** Saved positions to apply (with the version bump that requests it). */
  positions: Record<string, { x: number; y: number }> | null
  positionsVersion: number
  onSelect: (id: string | null) => void
  onExpand: (id: string) => void
  apiRef: React.MutableRefObject<GraphCanvasApi | null>
  className?: string
}

const CANVAS_BG = '#070b14'
const ACCENT = '#f59e0b'

const STYLE: cytoscape.StylesheetStyle[] = [
  {
    selector: 'node',
    style: {
      'background-color': 'data(color)',
      width: 26,
      height: 26,
      label: 'data(label)',
      'font-family': 'Inter, system-ui, sans-serif',
      'font-size': 10,
      color: '#e6eaf2',
      'text-valign': 'bottom',
      'text-halign': 'center',
      'text-margin-y': 5,
      'text-wrap': 'ellipsis',
      'text-max-width': '120px',
      'text-background-color': CANVAS_BG,
      'text-background-opacity': 0.75,
      'text-background-padding': '2px',
      'text-background-shape': 'roundrectangle',
      'border-width': 1,
      'border-color': 'rgba(255,255,255,0.3)',
      'overlay-opacity': 0,
    },
  },
  { selector: 'node.root', style: { width: 38, height: 38, 'border-width': 3, 'border-color': '#ffffff', 'font-weight': 'bold' } },
  { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#ffffff' } },
  { selector: 'node.match', style: { 'border-width': 3, 'border-color': ACCENT } },
  { selector: 'node.nomatch', style: { opacity: 0.3 } },
  { selector: 'node.pick', style: { 'border-width': 3, 'border-color': ACCENT, 'border-style': 'dashed' } },
  { selector: 'node.path', style: { 'border-width': 3, 'border-color': ACCENT } },
  { selector: 'node.dim', style: { opacity: 0.15 } },
  {
    selector: 'edge',
    style: {
      width: 1.2,
      'line-color': 'rgba(148,163,184,0.45)',
      'curve-style': 'bezier',
      'target-arrow-shape': 'triangle',
      'target-arrow-color': 'rgba(148,163,184,0.45)',
      'arrow-scale': 0.7,
      'font-family': 'Inter, system-ui, sans-serif',
      'font-size': 8,
      color: '#94a3b8',
      'text-rotation': 'autorotate',
      'text-background-color': CANVAS_BG,
      'text-background-opacity': 0.8,
      'text-background-padding': '1px',
      'overlay-opacity': 0,
    },
  },
  { selector: 'edge.labelled', style: { label: 'data(label)' } },
  { selector: 'edge.path', style: { width: 3, 'line-color': ACCENT, 'target-arrow-color': ACCENT } },
  { selector: 'edge.dim', style: { opacity: 0.1 } },
]

const layoutOptions = (randomize: boolean, fixed?: FcoseLayoutOptions['fixedNodeConstraint']): FcoseLayoutOptions => ({
  name: 'fcose',
  quality: 'default',
  randomize,
  animate: false,
  fit: true,
  padding: 30,
  nodeRepulsion: () => 4500,
  idealEdgeLength: () => 90,
  edgeElasticity: () => 0.45,
  ...(fixed && fixed.length ? { fixedNodeConstraint: fixed } : {}),
})

const PAN_STEP = 40

export function GraphCanvas({
  elements, selectedId, dimmedIds, pathIds, matchIds, pickIds, edgeLabels, positions, positionsVersion,
  onSelect, onExpand, apiRef, className = '',
}: GraphCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<cytoscape.Core | null>(null)
  const laidOut = useRef(false)
  // Handlers are read through refs so the cy instance is created once.
  const onSelectRef = useRef(onSelect)
  const onExpandRef = useRef(onExpand)
  useEffect(() => { onSelectRef.current = onSelect; onExpandRef.current = onExpand })

  // Create / destroy the instance.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    ensureFcose()
    const cy = cytoscape({
      container: host,
      elements: [],
      style: STYLE,
      minZoom: 0.15,
      maxZoom: 3,
      boxSelectionEnabled: false,
      autounselectify: false,
      pixelRatio: 'auto',
    })
    cy.on('tap', 'node', (e) => { onSelectRef.current(e.target.id()) })
    cy.on('tap', (e) => { if (e.target === cy) onSelectRef.current(null) })
    cy.on('dbltap', 'node', (e) => { onExpandRef.current(e.target.id()) })
    cyRef.current = cy
    laidOut.current = false

    const ro = new ResizeObserver(() => { cy.resize() })
    ro.observe(host)

    apiRef.current = {
      zoomIn: () => cy.zoom({ level: cy.zoom() * 1.25, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } }),
      zoomOut: () => cy.zoom({ level: cy.zoom() / 1.25, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } }),
      fit: () => cy.fit(undefined, 30),
      png: () => {
        if (!cy.nodes().length) return null
        return cy.png({ output: 'blob', full: true, scale: 2, bg: CANVAS_BG })
      },
      positions: () => {
        const out: Record<string, { x: number; y: number }> = {}
        cy.nodes().forEach((n) => {
          const p = n.position()
          out[n.id()] = { x: Math.round(p.x), y: Math.round(p.y) }
        })
        return out
      },
      relayout: () => { cy.layout(layoutOptions(true)).run() },
    }

    return () => {
      ro.disconnect()
      apiRef.current = null
      cyRef.current = null
      cy.destroy()
    }
  }, [apiRef])

  // Sync elements: remove what is gone, add what is new (seeded next to an
  // existing neighbour so the incremental layout grows outward), refresh
  // data on survivors, then lay out only when the node set changed.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    const wanted = new Map(elements.map((e) => [e.data.id, e]))
    const removed = cy.elements().filter((el) => !wanted.has(el.id()))
    const existingNodeIds = new Set(cy.nodes().map((n) => n.id()))
    const toAdd: cytoscape.ElementDefinition[] = []
    let nodeSetChanged = removed.length > 0
    cy.batch(() => {
      if (removed.length) cy.remove(removed)
      for (const el of elements) {
        const cur = cy.getElementById(el.data.id)
        if (cur.length) {
          cur.data({ ...el.data })
          if (el.classes !== undefined && el.group === 'nodes') {
            cur.toggleClass('root', el.classes.includes('root'))
          }
          continue
        }
        toAdd.push({ group: el.group, data: { ...el.data }, classes: el.classes })
        if (el.group === 'nodes') nodeSetChanged = true
      }
      const nodeDefs = toAdd.filter((d) => d.group === 'nodes')
      const edgeDefs = toAdd.filter((d) => d.group === 'edges')
      // Seed positions: a new node lands beside the first already-placed
      // neighbour (offset by a small deterministic angle), else at the centre.
      const added = cy.add(nodeDefs)
      const allEdges = elements.filter((e) => e.group === 'edges')
      added.forEach((n, i) => {
        const id = n.id()
        const link = allEdges.find((e) => (e.data.source === id && existingNodeIds.has(String(e.data.target)))
          || (e.data.target === id && existingNodeIds.has(String(e.data.source))))
        const anchorId = link ? (link.data.source === id ? String(link.data.target) : String(link.data.source)) : null
        const anchor = anchorId ? cy.getElementById(anchorId) : null
        const base = anchor && anchor.length ? anchor.position() : { x: 0, y: 0 }
        const angle = (i * 137.5 * Math.PI) / 180
        n.position({ x: base.x + Math.cos(angle) * 60, y: base.y + Math.sin(angle) * 60 })
      })
      cy.add(edgeDefs)
    })
    if (nodeSetChanged && cy.nodes().length) {
      cy.layout(layoutOptions(!laidOut.current)).run()
      laidOut.current = true
    }
  }, [elements])

  // Apply saved positions on request: place the nodes we know, keep them
  // fixed while fcose settles anything unplaced, then fit.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy || !positions || positionsVersion === 0) return
    const fixed: NonNullable<FcoseLayoutOptions['fixedNodeConstraint']> = []
    let unplaced = 0
    cy.nodes().forEach((n) => {
      const p = positions[n.id()]
      if (p) { n.position(p); fixed.push({ nodeId: n.id(), position: p }) }
      else unplaced++
    })
    if (unplaced > 0 && fixed.length) cy.layout(layoutOptions(false, fixed)).run()
    else cy.fit(undefined, 30)
    laidOut.current = true
  }, [positions, positionsVersion])

  // State classes.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.batch(() => {
      cy.elements().removeClass('dim path match nomatch pick labelled')
      cy.elements().unselect()
      if (selectedId) cy.getElementById(selectedId).select()
      if (edgeLabels) cy.edges().addClass('labelled')
      if (dimmedIds) cy.elements().forEach((el) => { if (dimmedIds.has(el.id())) el.addClass('dim') })
      if (pathIds) cy.elements().forEach((el) => { if (pathIds.has(el.id())) el.addClass('path') })
      if (matchIds) cy.nodes().forEach((n) => { n.addClass(matchIds.has(n.id()) ? 'match' : 'nomatch') })
      pickIds.forEach((id) => cy.getElementById(id).addClass('pick'))
    })
  }, [selectedId, dimmedIds, pathIds, matchIds, pickIds, edgeLabels, elements])

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const cy = cyRef.current
    if (!cy) return
    const api = apiRef.current
    switch (e.key) {
      case '+': case '=': api?.zoomIn(); break
      case '-': case '_': api?.zoomOut(); break
      case '0': case 'f': case 'F': api?.fit(); break
      case 'ArrowLeft': cy.panBy({ x: PAN_STEP, y: 0 }); break
      case 'ArrowRight': cy.panBy({ x: -PAN_STEP, y: 0 }); break
      case 'ArrowUp': cy.panBy({ x: 0, y: PAN_STEP }); break
      case 'ArrowDown': cy.panBy({ x: 0, y: -PAN_STEP }); break
      case 'Escape': onSelectRef.current(null); break
      default: return
    }
    e.preventDefault()
  }

  return (
    <div
      ref={hostRef}
      role="application"
      aria-label="Investigation graph canvas"
      aria-describedby="graph-canvas-keys"
      tabIndex={0}
      onKeyDown={onKeyDown}
      // Keyboard focus ring comes from the global [tabindex]:focus-visible rule.
      className={`h-full w-full touch-none select-none ${className}`}
    />
  )
}
