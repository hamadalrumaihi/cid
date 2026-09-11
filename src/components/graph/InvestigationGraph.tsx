'use client'

/** Investigation Graph — one Cytoscape surface over `public.graph_expand`
 *  (contract §2.7 / §5.2), shared by the Investigation Graph tool
 *  (NetworkView, any root) and the case Graph tab (rooted at the case).
 *
 *  Everything the picture shows came back from the RPC under the caller's
 *  own RLS: a node that is not visible is simply not a row, so no count,
 *  chip or legend entry is ever derived for a kind the server did not
 *  return. The client never infers an edge — "highlight path" is a BFS over
 *  the loaded subgraph only.
 *
 *  Progressive: the root loads at the chosen depth (1–3); double-click or
 *  "Expand" merges that node's own `graph_expand(node, 1)` in, capped at
 *  MAX_NODES with a visible notice; "Collapse branch" takes a subtree back
 *  out. Focus mode dims non-neighbours; two picked nodes highlight their
 *  shortest path; the search box highlights matching labels. Views (depth,
 *  hidden kinds, edge labels, dragged positions) save through lib/savedViews
 *  under `graph:<kind>:<id>`. "Export image" is `cy.png` — of the visible
 *  graph only, nothing the viewer could not already see.
 *
 *  The Cytoscape module (GraphCanvas) loads through next/dynamic so it never
 *  reaches the shared first-load chunk. */
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Database } from '@/lib/database.types'
import { rpc } from '@/lib/db'
import { downloadBlob } from '@/lib/format'
import {
  GRAPH_KIND_META, MAX_SAVED_POSITIONS, buildGraph, caseIdFor, collapseBranch, filterGraph, graphViewKey, kindCounts,
  matchingNodeIds, mergeExpansion, neighbourhood, nodeHref, nodeKey, parseGraphViewConfig, presentKinds, shortestPath,
  toCytoscapeElements, type Graph, type GraphNode, type GraphNodeKind, type GraphViewConfig,
} from '@/lib/graphModel'
import type { PreviewType } from '@/lib/entityPreview'
import { useSavedViews } from '@/lib/savedViews'
import { toast } from '@/lib/toast'
import { useNarrow } from '@/lib/useNarrow'
import { useToolNav } from '@/components/tools/useToolNav'
import {
  AccountIcon, CaseIcon, DocumentIcon, GangIcon, LinkIcon, NarcoticIcon, PersonIcon, PlaceIcon, ReceiptIcon, VehicleIcon,
} from '@/components/shell/icons'
import { ViewsMenu } from '@/components/shared/ViewsMenu'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Field'
import { EmptyState, ErrorNotice, Notice } from '@/components/ui/Notice'
import { Skeleton } from '@/components/ui/Skeleton'
import type { GraphCanvasApi } from './GraphCanvas'

const GraphCanvas = dynamic(() => import('./GraphCanvas').then((m) => m.GraphCanvas), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-lg" />,
})

const RecordPeek = dynamic(() => import('@/components/ui/RecordPeek').then((m) => m.RecordPeek), { ssr: false })

type ExpandRow = Database['public']['Functions']['graph_expand']['Returns'][number]

/** Hard ceiling on nodes kept client-side (the RPC caps one answer at 500). */
export const MAX_NODES = 500
const DEPTHS = [1, 2, 3] as const

/** Kinds RecordPeek can preview; the rest get the panel only. */
const PEEK_TYPE: Partial<Record<GraphNodeKind, PreviewType>> = {
  person: 'person', vehicle: 'vehicle', gang: 'gang', place: 'place', narcotic: 'narcotic', case: 'case', account: 'account',
}

const KIND_ICON: Record<GraphNodeKind, (p: { size?: number; className?: string }) => React.ReactElement> = {
  case: CaseIcon, person: PersonIcon, vehicle: VehicleIcon, gang: GangIcon, place: PlaceIcon, narcotic: NarcoticIcon,
  evidence: ReceiptIcon, report: DocumentIcon, account: AccountIcon, external_source: LinkIcon,
}

export interface InvestigationGraphProps {
  root: { kind: GraphNodeKind; id: string }
  /** The case the surface lives in (case Graph tab) — evidence/report links
   *  resolve through it when the graph itself does not say. */
  caseId?: string
  /** Canvas height in px (ignored in fullscreen). */
  height?: number
  fullscreenable?: boolean
  defaultDepth?: 1 | 2 | 3
}

interface PathPick { a: string | null; b: string | null }

async function expandRpc(kind: string, id: string, depth: number): Promise<{ rows: ExpandRow[] } | { error: string }> {
  const res = await rpc('graph_expand', { p_kind: kind, p_id: id, p_depth: depth, p_limit: MAX_NODES })
  if (res.error) return { error: res.error.message }
  return { rows: (res.data ?? []) as ExpandRow[] }
}

export function InvestigationGraph({ root, caseId, height = 520, fullscreenable = true, defaultDepth = 1 }: InvestigationGraphProps) {
  const narrow = useNarrow()
  const nav = useToolNav()
  const rootKey = nodeKey(root.kind, root.id)
  const apiRef = useRef<GraphCanvasApi | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const [depth, setDepth] = useState<number>(defaultDepth)
  const [graph, setGraph] = useState<Graph | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [hiddenKinds, setHiddenKinds] = useState<Set<GraphNodeKind>>(() => new Set())
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [focus, setFocus] = useState(false)
  const [pick, setPick] = useState<PathPick>({ a: null, b: null })
  const [edgeLabels, setEdgeLabels] = useState(false)
  const [expanding, setExpanding] = useState<string | null>(null)
  const [capNotice, setCapNotice] = useState<string | null>(null)
  const [peek, setPeek] = useState<{ type: PreviewType; id: string } | null>(null)
  const [fullscreen, setFullscreen] = useState<'off' | 'native' | 'overlay'>('off')
  const [sheet, setSheet] = useState<'none' | 'controls' | 'node'>('none')
  const [activeView, setActiveView] = useState<string | null>(null)
  const [positions, setPositions] = useState<GraphViewConfig['positions'] | null>(null)
  const [positionsVersion, setPositionsVersion] = useState(0)
  const pendingPositions = useRef<GraphViewConfig['positions'] | null>(null)

  const sv = useSavedViews<GraphViewConfig>(graphViewKey(root.kind, root.id))

  /* ── Load the root ─────────────────────────────────────────────────── */
  useEffect(() => {
    let live = true
    const t = window.setTimeout(async () => {
      setLoading(true)
      setError(null)
      const out = await expandRpc(root.kind, root.id, depth)
      if (!live) return
      setLoading(false)
      if ('error' in out) { setError(out.error); return }
      setGraph(buildGraph(out.rows, root))
      setSelected(null)
      setFocus(false)
      setPick({ a: null, b: null })
      setCapNotice(null)
      if (pendingPositions.current) {
        setPositions(pendingPositions.current)
        pendingPositions.current = null
        setPositionsVersion((v) => v + 1)
      }
    }, 0)
    return () => { live = false; window.clearTimeout(t) }
  }, [root, root.kind, root.id, depth, reloadTick])

  /* ── Default saved view, applied once per root ─────────────────────── */
  const appliedDefault = useRef<string | null>(null)
  const applyView = useCallback((name: string, raw: unknown) => {
    const cfg = parseGraphViewConfig(raw)
    if (!cfg) return
    setActiveView(name)
    setHiddenKinds(new Set(cfg.hiddenKinds as GraphNodeKind[]))
    setEdgeLabels(cfg.edgeLabels)
    if (cfg.depth !== depth) {
      pendingPositions.current = cfg.positions
      setDepth(cfg.depth)
    } else {
      setPositions(cfg.positions)
      setPositionsVersion((v) => v + 1)
    }
  }, [depth])
  useEffect(() => {
    if (!sv.loaded || appliedDefault.current === rootKey) return
    appliedDefault.current = rootKey
    const view = sv.defaultView
    if (!view) return
    const t = window.setTimeout(() => applyView(view.name, view.config), 0)
    return () => window.clearTimeout(t)
  }, [sv.loaded, sv.defaultView, rootKey, applyView])

  /* ── Derived picture ───────────────────────────────────────────────── */
  const visible = useMemo(() => {
    if (!graph) return null
    const keep = presentKinds(graph).filter((k) => !hiddenKinds.has(k))
    return filterGraph(graph, { kinds: keep })
  }, [graph, hiddenKinds])
  const elements = useMemo(() => (visible ? toCytoscapeElements(visible) : []), [visible])
  const counts = useMemo(() => (graph ? kindCounts(graph) : {}), [graph])
  const kinds = useMemo(() => (graph ? presentKinds(graph) : []), [graph])
  const matchIds = useMemo(() => (visible && query.trim() ? matchingNodeIds(visible, query) : null), [visible, query])
  const path = useMemo(() => (visible && pick.a && pick.b ? shortestPath(visible, pick.a, pick.b) : null), [visible, pick])
  const pathIds = useMemo(() => (path ? new Set([...path.nodes, ...path.edges]) : null), [path])
  const dimmedIds = useMemo(() => {
    if (!visible || !focus || !selected) return null
    const near = neighbourhood(visible, selected)
    const out = new Set<string>()
    for (const id of Object.keys(visible.nodes)) if (!near.has(id)) out.add(id)
    for (const e of Object.values(visible.edges)) if (!near.has(e.source) || !near.has(e.target)) out.add(e.id)
    return out
  }, [visible, focus, selected])
  const pickIds = useMemo(() => new Set([pick.a, pick.b].filter((x): x is string => !!x)), [pick])
  const selectedNode: GraphNode | null = selected && visible ? visible.nodes[selected] ?? null : null

  /* ── Actions ───────────────────────────────────────────────────────── */
  const expand = useCallback(async (id: string) => {
    if (!graph || expanding) return
    const n = graph.nodes[id]
    if (!n) return
    if (Object.keys(graph.nodes).length >= MAX_NODES) {
      setCapNotice(`The graph holds ${MAX_NODES} nodes — collapse a branch or hide a kind before expanding further.`)
      return
    }
    setExpanding(id)
    const out = await expandRpc(n.kind, n.refId, 1)
    setExpanding(null)
    if ('error' in out) { toast(out.error, 'danger'); return }
    const merged = mergeExpansion(graph, out.rows, MAX_NODES)
    setGraph(merged.graph)
    if (merged.truncated) setCapNotice(`Expansion stopped at ${MAX_NODES} nodes — some of ${n.label}'s links were not added.`)
    else if (merged.added === 0) toast(`Nothing further links to ${n.label} (that you can see).`, 'info')
  }, [graph, expanding])

  const collapse = useCallback((id: string) => {
    if (!graph) return
    const next = collapseBranch(graph, id)
    if (next === graph) return
    const removed = Object.keys(graph.nodes).length - Object.keys(next.nodes).length
    setGraph(next)
    setCapNotice(null)
    if (removed === 0) toast('Nothing hangs only off this node.', 'info')
  }, [graph])

  const toggleKind = (k: GraphNodeKind) => {
    setHiddenKinds((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k); else next.add(k)
      return next
    })
    setActiveView(null)
  }

  const select = useCallback((id: string | null) => {
    setSelected(id)
    if (narrow) setSheet(id ? 'node' : 'none')
  }, [narrow])

  const pickPath = (id: string, end: 'a' | 'b') => {
    setPick((p) => {
      const next = { ...p, [end]: id }
      if (next.a && next.a === next.b) return { a: id, b: null }
      return next
    })
  }

  const exportImage = () => {
    const blob = apiRef.current?.png()
    if (!blob) { toast('Nothing to export yet.', 'info'); return }
    const rootLabel = graph?.root ? graph.nodes[graph.root]?.label ?? root.kind : root.kind
    downloadBlob(blob, `graph-${rootLabel.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`)
  }

  /* ── Fullscreen (native, else a fixed overlay) ─────────────────────── */
  useEffect(() => {
    const onChange = () => { if (!document.fullscreenElement) setFullscreen((f) => (f === 'native' ? 'off' : f)) }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  useEffect(() => {
    if (fullscreen !== 'overlay') return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen('off') }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [fullscreen])
  const toggleFullscreen = async () => {
    if (fullscreen === 'native') { await document.exitFullscreen().catch(() => undefined); setFullscreen('off'); return }
    if (fullscreen === 'overlay') { setFullscreen('off'); return }
    const el = containerRef.current
    if (el && document.fullscreenEnabled && el.requestFullscreen) {
      try { await el.requestFullscreen(); setFullscreen('native'); return } catch { /* fall through to the overlay */ }
    }
    setFullscreen('overlay')
  }

  /* ── Saved views ───────────────────────────────────────────────────── */
  const currentConfig: GraphViewConfig = { depth, hiddenKinds: [...hiddenKinds], edgeLabels, positions: {} }
  const snapshotConfig = (c: GraphViewConfig): GraphViewConfig => {
    const all = apiRef.current?.positions() ?? {}
    const capped: GraphViewConfig['positions'] = {}
    for (const [id, p] of Object.entries(all).slice(0, MAX_SAVED_POSITIONS)) capped[id] = p
    return { ...c, positions: capped }
  }
  const onSelectView = (sel: { preset?: string; view?: string } | null) => {
    if (!sel?.view) { setActiveView(null); return }
    const v = sv.views.find((x) => x.name === sel.view)
    if (v) applyView(v.name, v.config)
  }

  /* ── Rendering ─────────────────────────────────────────────────────── */
  const isFs = fullscreen !== 'off'
  const nodeCount = visible ? Object.keys(visible.nodes).length : 0
  const edgeCount = visible ? Object.keys(visible.edges).length : 0
  const onlyRoot = !!graph && Object.keys(graph.nodes).length <= 1

  const depthSelect = (
    <Select aria-label="Depth" value={depth} onChange={(e) => { setDepth(Number(e.target.value)); setActiveView(null) }}
      className={narrow ? '' : 'w-auto py-1.5 text-xs'}>
      {DEPTHS.map((d) => <option key={d} value={d}>Depth {d}</option>)}
    </Select>
  )

  const kindChips = kinds.length > 0 && (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show or hide kinds">
      {kinds.map((k) => {
        const on = !hiddenKinds.has(k)
        const meta = GRAPH_KIND_META[k]
        return (
          <button
            key={k}
            type="button"
            aria-pressed={on}
            onClick={() => toggleKind(k)}
            className={`inline-flex touch-manipulation items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition ${narrow ? 'min-h-11' : 'min-h-9 lg:min-h-8'} ${
              on ? 'border-white/15 bg-white/5 text-slate-200 hover:bg-white/10' : 'border-white/10 text-slate-400 line-through hover:text-slate-200'
            }`}
          >
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.color, opacity: on ? 1 : 0.4 }} />
            {meta.plural}
            <span className="tabular-nums text-slate-400">{counts[k] ?? 0}</span>
          </button>
        )
      })}
    </div>
  )

  const secondaryControls = (
    <>
      <Button size={narrow ? 'md' : 'sm'} variant="secondary" aria-pressed={edgeLabels} onClick={() => { setEdgeLabels((v) => !v); setActiveView(null) }}>
        {edgeLabels ? 'Hide relationship labels' : 'Show relationship labels'}
      </Button>
      <Button size={narrow ? 'md' : 'sm'} variant="secondary" onClick={() => apiRef.current?.relayout()}>Re-run layout</Button>
      <Button size={narrow ? 'md' : 'sm'} variant="secondary" onClick={exportImage} disabled={!nodeCount}>Export image</Button>
      <Button size={narrow ? 'md' : 'sm'} variant="secondary" onClick={() => setReloadTick((t) => t + 1)}>Reload</Button>
      <ViewsMenu<GraphViewConfig>
        label="Graph view"
        emptyLabel="Unsaved layout"
        sv={sv}
        activeView={activeView}
        currentConfig={currentConfig}
        normalize={snapshotConfig}
        onSelect={onSelectView}
        savePrompt="Name this graph view (depth, hidden kinds and node positions are saved)."
      />
    </>
  )

  const zoomControls = (
    <div className="flex flex-col gap-1" role="group" aria-label="Zoom">
      <Button size={narrow ? 'md' : 'sm'} variant="secondary" aria-label="Zoom in" onClick={() => apiRef.current?.zoomIn()} className="px-0 lg:w-8">+</Button>
      <Button size={narrow ? 'md' : 'sm'} variant="secondary" aria-label="Zoom out" onClick={() => apiRef.current?.zoomOut()} className="px-0 lg:w-8">−</Button>
      <Button size={narrow ? 'md' : 'sm'} variant="secondary" aria-label="Fit graph to view" onClick={() => apiRef.current?.fit()} className="px-1 text-xs lg:w-8">Fit</Button>
    </div>
  )

  const legend = kinds.length > 0 && (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400" aria-label="Legend">
      {kinds.map((k) => (
        <li key={k} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: GRAPH_KIND_META[k].color }} />
          {GRAPH_KIND_META[k].label}
        </li>
      ))}
      <li className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-full border-2 border-white" />Root</li>
    </ul>
  )

  const panel = selectedNode && visible && (
    <NodePanel
      node={selectedNode}
      graph={visible}
      caseId={caseId ?? caseIdFor(visible, selectedNode.id)}
      isRoot={selectedNode.id === visible.root}
      expanding={expanding === selectedNode.id}
      focus={focus}
      pick={pick}
      inWorkspace={nav.inWorkspace}
      onOpenHref={nav.openHref}
      onClose={() => select(null)}
      onSelect={select}
      onExpand={() => void expand(selectedNode.id)}
      onCollapse={() => collapse(selectedNode.id)}
      onFocus={() => setFocus((f) => !f)}
      onPick={(end) => pickPath(selectedNode.id, end)}
      onClearPath={() => setPick({ a: null, b: null })}
      onPeek={PEEK_TYPE[selectedNode.kind] ? () => setPeek({ type: PEEK_TYPE[selectedNode.kind]!, id: selectedNode.refId }) : undefined}
      narrow={narrow}
    />
  )

  const canvasHeight = isFs ? undefined : height

  return (
    <div
      ref={containerRef}
      className={`flex flex-col gap-3 ${fullscreen === 'overlay' ? 'fixed inset-0 z-modal overflow-auto overscroll-contain bg-canvas p-3 safe-bottom safe-x' : ''} ${fullscreen === 'native' ? 'h-full bg-canvas p-3' : ''}`}
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Search the graph"
          type="search"
          name="graph-search"
          autoComplete="off"
          spellCheck={false}
          placeholder="Find a node… e.g. a name or plate"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={narrow ? 'flex-1' : 'w-56 py-1.5 text-xs'}
        />
        {!narrow && depthSelect}
        {narrow ? (
          <Button size="md" variant="secondary" onClick={() => setSheet('controls')} aria-haspopup="dialog">Controls</Button>
        ) : secondaryControls}
        {fullscreenable && (
          <Button size={narrow ? 'md' : 'sm'} variant="secondary" onClick={() => void toggleFullscreen()} aria-pressed={isFs}>
            {isFs ? 'Exit fullscreen' : 'Fullscreen'}
          </Button>
        )}
      </div>
      {!narrow && kindChips}

      <p className="text-xs text-slate-400" aria-live="polite">
        {loading ? 'Loading graph…' : `${nodeCount} node${nodeCount === 1 ? '' : 's'} · ${edgeCount} link${edgeCount === 1 ? '' : 's'} · depth ${depth}`}
        {path && ` · path: ${path.nodes.length - 1} hop${path.nodes.length === 2 ? '' : 's'}`}
        {pick.a && pick.b && !path && ' · no path between the picked nodes in the loaded graph'}
      </p>
      <p id="graph-canvas-keys" className="sr-only">
        Click a node for details, double-click to expand it. With the canvas focused: plus and minus zoom, arrow keys pan, 0 fits the graph, Escape clears the selection.
      </p>
      {capNotice && <Notice text={capNotice} className="py-3" />}

      {/* Canvas */}
      {error ? (
        <ErrorNotice message={error} onRetry={() => setReloadTick((t) => t + 1)} />
      ) : loading && !graph ? (
        <div role="status" aria-busy="true" style={{ height: canvasHeight }} className={isFs ? 'min-h-0 flex-1' : ''}>
          <span className="sr-only">Loading graph…</span>
          <Skeleton className="h-full w-full rounded-lg" />
        </div>
      ) : onlyRoot ? (
        <EmptyState
          title="No linked records to chart"
          hint={depth < 3
            ? 'Nothing you can see links to this record at this depth. Try a deeper search.'
            : 'Nothing you can see links to this record.'}
          action={depth < 3 ? { label: `Try depth ${depth + 1}`, onClick: () => setDepth(depth + 1) } : undefined}
        />
      ) : (
        <div
          className={`relative overflow-hidden rounded-lg border border-white/10 bg-ink-950 ${isFs ? 'min-h-0 flex-1' : ''}`}
          style={{ height: canvasHeight }}
        >
          <GraphCanvas
            elements={elements}
            selectedId={selected}
            dimmedIds={dimmedIds}
            pathIds={pathIds}
            matchIds={matchIds}
            pickIds={pickIds}
            edgeLabels={edgeLabels}
            positions={positions}
            positionsVersion={positionsVersion}
            onSelect={select}
            onExpand={(id) => void expand(id)}
            apiRef={apiRef}
          />
          <div className="absolute bottom-3 right-3">{zoomControls}</div>
          {loading && (
            <p className="absolute left-3 top-3 rounded-lg bg-ink-900/90 px-2 py-1 text-xs text-slate-300">Loading…</p>
          )}
          {!narrow && panel && (
            <div className="absolute right-3 top-3 max-h-[calc(100%-1.5rem)] w-72 overflow-y-auto overscroll-contain rounded-lg border border-white/10 bg-ink-850 shadow-pop">
              {panel}
            </div>
          )}
        </div>
      )}

      {legend}

      {/* Mobile sheets */}
      {narrow && sheet === 'controls' && (
        <BottomSheet title="Graph controls" onClose={() => setSheet('none')}>
          <div className="space-y-3">
            {depthSelect}
            {kindChips}
            <div className="flex flex-col gap-2">{secondaryControls}</div>
          </div>
        </BottomSheet>
      )}
      {narrow && sheet === 'node' && panel && (
        <BottomSheet title="Node" onClose={() => select(null)} hideTitle>
          {panel}
        </BottomSheet>
      )}

      {peek && <RecordPeek type={peek.type} id={peek.id} onClose={() => setPeek(null)} />}
    </div>
  )
}

/* ── Node details panel ────────────────────────────────────────────────── */

function NodePanel({
  node, graph, caseId, isRoot, expanding, focus, pick, inWorkspace, onOpenHref, onClose, onSelect, onExpand, onCollapse,
  onFocus, onPick, onClearPath, onPeek, narrow,
}: {
  node: GraphNode
  graph: Graph
  caseId: string | null
  isRoot: boolean
  expanding: boolean
  focus: boolean
  pick: PathPick
  inWorkspace: boolean
  onOpenHref: (href: string) => void
  onClose: () => void
  onSelect: (id: string) => void
  onExpand: () => void
  onCollapse: () => void
  onFocus: () => void
  onPick: (end: 'a' | 'b') => void
  onClearPath: () => void
  onPeek?: () => void
  narrow: boolean
}) {
  const meta = GRAPH_KIND_META[node.kind]
  const Icon = KIND_ICON[node.kind]
  const href = nodeHref(node.kind, node.refId, { caseId })
  const size = narrow ? 'md' : 'sm'
  const edges = Object.values(graph.edges).filter((e) => e.source === node.id || e.target === node.id)
  const isA = pick.a === node.id
  const isB = pick.b === node.id

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.color }} />
            <Icon size={13} className="text-slate-400" aria-hidden />
            {meta.label}{isRoot && ' · root'}
          </p>
          <p className="mt-0.5 break-words text-sm font-semibold text-white">{node.label}</p>
          {node.sublabel && <p className="break-words text-xs text-slate-400">{node.sublabel}</p>}
          <p className="mt-1 text-xs tabular-nums text-slate-400">{node.degree} connection{node.degree === 1 ? '' : 's'} · {node.depth} hop{node.depth === 1 ? '' : 's'} from root</p>
        </div>
        {!narrow && (
          <button
            type="button"
            aria-label="Close details"
            onClick={onClose}
            className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg text-xl leading-none text-slate-400 transition hover:bg-white/5 hover:text-white"
          >
            &times;
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {href && (
          <Link
            href={href}
            onClick={(e) => { if (inWorkspace) { e.preventDefault(); onOpenHref(href) } }}
            className={`inline-flex touch-manipulation items-center justify-center rounded-lg bg-badge-500 px-3 font-medium text-white transition hover:brightness-110 ${narrow ? 'min-h-11 text-sm' : 'min-h-9 text-xs'}`}
          >
            Open record
          </Link>
        )}
        {onPeek && <Button size={size} variant="secondary" onClick={onPeek}>Preview</Button>}
        <Button size={size} variant="secondary" onClick={onExpand} loading={expanding}>Expand</Button>
        {!isRoot && <Button size={size} variant="secondary" onClick={onCollapse}>Collapse branch</Button>}
        <Button size={size} variant="secondary" aria-pressed={focus} onClick={onFocus}>{focus ? 'Exit focus' : 'Focus'}</Button>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-slate-400">Highlight path</p>
        <div className="flex flex-wrap gap-1.5">
          <Button size={size} variant="secondary" aria-pressed={isA} onClick={() => onPick('a')}>{isA ? 'Start: here' : 'Start here'}</Button>
          <Button size={size} variant="secondary" aria-pressed={isB} onClick={() => onPick('b')}>{isB ? 'End: here' : 'End here'}</Button>
          {(pick.a || pick.b) && <Button size={size} variant="ghost" onClick={onClearPath}>Clear</Button>}
        </div>
      </div>

      {edges.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-slate-400">Relationships</p>
          <ul className="divide-y divide-white/5 rounded-lg border border-white/5">
            {edges.slice(0, 12).map((e) => {
              const otherId = e.source === node.id ? e.target : e.source
              const other = graph.nodes[otherId]
              if (!other) return null
              const outgoing = e.source === node.id
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(otherId)}
                    className={`flex w-full touch-manipulation items-center gap-2 px-2 text-left text-xs transition hover:bg-white/5 ${narrow ? 'min-h-11' : 'min-h-9'}`}
                  >
                    <span aria-hidden className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: GRAPH_KIND_META[other.kind].color }} />
                    <span className="min-w-0 flex-1 truncate text-slate-200">{other.label}</span>
                    <span className="flex-shrink-0 text-slate-400">{outgoing ? e.label : `← ${e.label}`}</span>
                    {e.confidence && <Badge tone="neutral" className="flex-shrink-0">{e.confidence.replace(/_/g, ' ')}</Badge>}
                  </button>
                </li>
              )
            })}
            {edges.length > 12 && <li className="px-2 py-1.5 text-xs text-slate-400">and {edges.length - 12} more</li>}
          </ul>
        </div>
      )}
    </div>
  )
}

/* ── Mobile bottom sheet ───────────────────────────────────────────────── */

function BottomSheet({ title, onClose, children, hideTitle = false }: {
  title: string
  onClose: () => void
  children: React.ReactNode
  hideTitle?: boolean
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    // Focus moves into the sheet and back to the opener on close.
    const opener = document.activeElement
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus()
    }
  }, [onClose])
  return (
    <div className="fixed inset-0 z-modal flex items-end bg-ink-950/70" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[75dvh] w-full overflow-y-auto overscroll-contain rounded-t-xl border-t border-white/10 bg-ink-850 p-4 safe-bottom safe-x shadow-pop"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className={`text-[13px] font-semibold text-white ${hideTitle ? 'sr-only' : ''}`}>{title}</h3>
          <Button ref={closeRef} size="md" variant="ghost" onClick={onClose} className="ml-auto">Close</Button>
        </div>
        {children}
      </div>
    </div>
  )
}
