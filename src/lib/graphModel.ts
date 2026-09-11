/** Investigation Graph model — the pure, tested half of the Cytoscape surface
 *  (contract §2.7 / §5.2). Everything here operates on the row shape
 *  `public.graph_expand` returns and knows nothing about the canvas:
 *
 *   · `buildGraph` folds rows into a deduped node/edge map with degrees;
 *   · `mergeExpansion` layers a further `graph_expand(node)` answer in
 *     (progressive loading), `collapseBranch` takes it out again;
 *   · `shortestPath` is a plain BFS over the LOADED subgraph — the client never
 *     infers an edge the server did not return;
 *   · `filterGraph` / `matchingNodeIds` drive the kind chips and the search box;
 *   · `toCytoscapeElements` is the only bridge to the renderer;
 *   · `nodeHref` spells the one deep link per node kind.
 *
 *  Authorization lives in the RPC (INVOKER + `perm_registry_visible`): a node
 *  that is not in the rows does not exist here, and no count or placeholder
 *  is ever derived for it. CI never appears — the RPC has no CI arm. */
import { caseLink } from './caseLinks'
import { RECORD_PARAM, hasRecordTabs, type ToolId } from './toolsModel'

/* ── Vocabulary (mirrors the RPC's node/edge kinds) ─────────────────────── */

export const GRAPH_NODE_KINDS = [
  'case', 'person', 'vehicle', 'gang', 'place', 'narcotic', 'evidence', 'report', 'account', 'external_source',
] as const
export type GraphNodeKind = (typeof GRAPH_NODE_KINDS)[number]

export const isGraphNodeKind = (k: unknown): k is GraphNodeKind =>
  typeof k === 'string' && (GRAPH_NODE_KINDS as readonly string[]).includes(k)

export interface GraphKindMeta {
  label: string
  plural: string
  /** Canvas fill (hex — Cytoscape styles are not Tailwind). */
  color: string
  /** shell/icons key rendered by the legend and the node panel. */
  icon: 'case' | 'person' | 'vehicle' | 'gang' | 'place' | 'narcotic' | 'receipt' | 'document' | 'account' | 'link'
}

/** One fill per kind. Violet is deliberately absent (reserved for SIB). */
export const GRAPH_KIND_META: Record<GraphNodeKind, GraphKindMeta> = {
  case:            { label: 'Case',            plural: 'Cases',            color: '#60a5fa', icon: 'case' },
  person:          { label: 'Person',          plural: 'Persons',          color: '#fbbf24', icon: 'person' },
  vehicle:         { label: 'Vehicle',         plural: 'Vehicles',         color: '#22d3ee', icon: 'vehicle' },
  gang:            { label: 'Gang',            plural: 'Gangs',            color: '#fb7185', icon: 'gang' },
  place:           { label: 'Place',           plural: 'Places',           color: '#34d399', icon: 'place' },
  narcotic:        { label: 'Narcotic',        plural: 'Narcotics',        color: '#a3e635', icon: 'narcotic' },
  evidence:        { label: 'Evidence',        plural: 'Evidence',         color: '#f472b6', icon: 'receipt' },
  report:          { label: 'Report',          plural: 'Reports',          color: '#94a3b8', icon: 'document' },
  account:         { label: 'Account',         plural: 'Accounts',         color: '#38bdf8', icon: 'account' },
  external_source: { label: 'External source', plural: 'External sources', color: '#fb923c', icon: 'link' },
}

export const EDGE_KINDS = [
  'involved_in', 'suspect_in', 'witness_in', 'victim_in', 'owns', 'drives', 'member_of', 'associated_with',
  'seen_at', 'located_at', 'mentioned_in', 'evidence_of', 'source_for', 'linked_to', 'related_case',
] as const
export type EdgeKind = (typeof EDGE_KINDS)[number]

export const EDGE_KIND_LABEL: Record<EdgeKind, string> = {
  involved_in: 'involved in',
  suspect_in: 'suspect in',
  witness_in: 'witness in',
  victim_in: 'victim in',
  owns: 'owns',
  drives: 'drives',
  member_of: 'member of',
  associated_with: 'associated with',
  seen_at: 'seen at',
  located_at: 'located at',
  mentioned_in: 'mentioned in',
  evidence_of: 'evidence of',
  source_for: 'source for',
  linked_to: 'linked to',
  related_case: 'related case',
}

/** Human label for an edge — the server's `edge_label` (e.g. the intel-link
 *  role) wins, then the vocabulary, then the raw kind with underscores spaced. */
export function edgeLabel(kind: string | null | undefined, explicit?: string | null): string {
  if (explicit && explicit.trim()) return explicit.trim()
  if (!kind) return ''
  return (EDGE_KIND_LABEL as Record<string, string>)[kind] ?? kind.replace(/_/g, ' ')
}

/* ── Shapes ─────────────────────────────────────────────────────────────── */

/** One `graph_expand` row (the generated Returns type, re-declared so this
 *  module stays free of the 18k-line types file). */
export interface GraphExpandRow {
  node_kind: string
  node_id: string
  label: string | null
  sublabel: string | null
  depth: number | null
  edge_kind: string | null
  from_kind: string | null
  from_id: string | null
  to_kind: string | null
  to_id: string | null
  confidence: string | null
  provenance: string | null
  edge_label: string | null
}

export interface GraphNode {
  /** `<kind>:<uuid>` — the canvas id. */
  id: string
  kind: GraphNodeKind
  refId: string
  label: string
  sublabel: string
  /** Hops from the root (root = 0). */
  depth: number
  /** Distinct neighbours in the loaded graph. */
  degree: number
}

export interface GraphEdge {
  id: string
  kind: string
  source: string
  target: string
  label: string
  confidence: string | null
  provenance: string | null
}

export interface Graph {
  /** Insertion-ordered maps (plain objects) — cheap to spread into React state. */
  nodes: Record<string, GraphNode>
  edges: Record<string, GraphEdge>
  root: string | null
}

export const nodeKey = (kind: string, id: string): string => `${kind}:${id}`
const edgeKey = (kind: string, from: string, to: string): string => `${kind}|${from}|${to}`

export const emptyGraph = (): Graph => ({ nodes: {}, edges: {}, root: null })

/* ── Building ───────────────────────────────────────────────────────────── */

function addRow(g: Graph, r: GraphExpandRow, depthOffset: number): void {
  if (!isGraphNodeKind(r.node_kind) || !r.node_id) return
  const id = nodeKey(r.node_kind, r.node_id)
  const depth = Math.max(0, (r.depth ?? 0) + depthOffset)
  const existing = g.nodes[id]
  if (!existing) {
    g.nodes[id] = {
      id, kind: r.node_kind, refId: r.node_id,
      label: (r.label ?? '').trim() || GRAPH_KIND_META[r.node_kind].label,
      sublabel: (r.sublabel ?? '').trim(),
      depth, degree: 0,
    }
  } else if (depth < existing.depth) {
    existing.depth = depth
  }
  if (r.edge_kind && r.from_kind && r.from_id && r.to_kind && r.to_id) {
    if (!isGraphNodeKind(r.from_kind) || !isGraphNodeKind(r.to_kind)) return
    const from = nodeKey(r.from_kind, r.from_id)
    const to = nodeKey(r.to_kind, r.to_id)
    if (from === to) return
    const eid = edgeKey(r.edge_kind, from, to)
    if (!g.edges[eid]) {
      g.edges[eid] = {
        id: eid, kind: r.edge_kind, source: from, target: to,
        label: edgeLabel(r.edge_kind, r.edge_label),
        confidence: r.confidence ?? null, provenance: r.provenance ?? null,
      }
    }
  }
}

/** Drop edges whose endpoint is not a node, then recount degrees. */
function settle(g: Graph): Graph {
  const neighbours = new Map<string, Set<string>>()
  for (const id of Object.keys(g.nodes)) neighbours.set(id, new Set())
  for (const [eid, e] of Object.entries(g.edges)) {
    if (!g.nodes[e.source] || !g.nodes[e.target]) { delete g.edges[eid]; continue }
    neighbours.get(e.source)!.add(e.target)
    neighbours.get(e.target)!.add(e.source)
  }
  for (const [id, n] of neighbours) g.nodes[id].degree = n.size
  return g
}

/** Fold the rows of one `graph_expand(root, depth)` call into a graph. The
 *  root is the depth-0 row (falls back to the first row). Duplicate nodes and
 *  edges collapse; nothing is invented for a kind the rows do not carry. */
export function buildGraph(rows: readonly GraphExpandRow[], root?: { kind: string; id: string }): Graph {
  const g = emptyGraph()
  for (const r of rows) addRow(g, r, 0)
  const rootRow = rows.find((r) => (r.depth ?? 0) === 0) ?? rows[0]
  const wanted = root ? nodeKey(root.kind, root.id) : rootRow ? nodeKey(rootRow.node_kind, rootRow.node_id) : null
  g.root = wanted && g.nodes[wanted] ? wanted : null
  return settle(g)
}

/** Merge a further `graph_expand(node, 1)` answer. New nodes sit one ring
 *  further out than the expanded node; existing nodes keep their depth.
 *  `maxNodes` caps the merged size — rows past the cap are dropped and
 *  `truncated` reports it so the surface can say so. */
export function mergeExpansion(
  graph: Graph, rows: readonly GraphExpandRow[], maxNodes = Infinity,
): { graph: Graph; added: number; truncated: boolean } {
  const g: Graph = { nodes: { ...graph.nodes }, edges: { ...graph.edges }, root: graph.root }
  const rootRow = rows.find((r) => (r.depth ?? 0) === 0)
  const anchor = rootRow ? g.nodes[nodeKey(rootRow.node_kind, rootRow.node_id)] : undefined
  const offset = anchor ? anchor.depth : 0
  const before = Object.keys(g.nodes).length
  let truncated = false
  for (const r of rows) {
    const id = nodeKey(r.node_kind, r.node_id)
    const isNew = !g.nodes[id]
    if (isNew && Object.keys(g.nodes).length >= maxNodes) {
      truncated = true
      continue
    }
    addRow(g, r, offset)
  }
  settle(g)
  return { graph: g, added: Object.keys(g.nodes).length - before, truncated }
}

/** Every node reachable from `start` without crossing `blocked`. */
function reach(g: Graph, start: string, blocked: string | null): Set<string> {
  const seen = new Set<string>()
  if (!g.nodes[start]) return seen
  const adj = adjacency(g)
  const queue = [start]
  seen.add(start)
  while (queue.length) {
    const cur = queue.shift()!
    for (const next of adj.get(cur) ?? []) {
      if (next === blocked || seen.has(next)) continue
      seen.add(next)
      queue.push(next)
    }
  }
  return seen
}

function adjacency(g: Graph): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>()
  for (const id of Object.keys(g.nodes)) adj.set(id, new Set())
  for (const e of Object.values(g.edges)) {
    adj.get(e.source)?.add(e.target)
    adj.get(e.target)?.add(e.source)
  }
  return adj
}

/** Remove every node that is reachable from the root ONLY through `nodeId`
 *  (the node itself stays). A branch that is also reachable another way is
 *  untouched. Collapsing the root, or an unknown node, is a no-op. */
export function collapseBranch(graph: Graph, nodeId: string): Graph {
  if (!graph.root || nodeId === graph.root || !graph.nodes[nodeId]) return graph
  const keep = reach(graph, graph.root, nodeId)
  keep.add(nodeId)
  const g: Graph = { nodes: {}, edges: { ...graph.edges }, root: graph.root }
  for (const [id, n] of Object.entries(graph.nodes)) if (keep.has(id)) g.nodes[id] = { ...n }
  return settle(g)
}

/** Unweighted shortest path (BFS, edges undirected) between two nodes —
 *  ids in order plus the edge ids walked. null when disconnected. */
export function shortestPath(graph: Graph, a: string, b: string): { nodes: string[]; edges: string[] } | null {
  if (!graph.nodes[a] || !graph.nodes[b]) return null
  if (a === b) return { nodes: [a], edges: [] }
  const adj = adjacency(graph)
  const prev = new Map<string, string>()
  const seen = new Set<string>([a])
  const queue = [a]
  while (queue.length) {
    const cur = queue.shift()!
    if (cur === b) break
    for (const next of adj.get(cur) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      prev.set(next, cur)
      queue.push(next)
    }
  }
  if (!seen.has(b)) return null
  const nodes: string[] = [b]
  while (nodes[0] !== a) nodes.unshift(prev.get(nodes[0])!)
  const edges: string[] = []
  for (let i = 0; i < nodes.length - 1; i++) {
    const x = nodes[i], y = nodes[i + 1]
    const e = Object.values(graph.edges).find((ed) =>
      (ed.source === x && ed.target === y) || (ed.source === y && ed.target === x))
    if (e) edges.push(e.id)
  }
  return { nodes, edges }
}

/** Neighbour ids of a node (plus the node itself) — focus mode dims the rest. */
export function neighbourhood(graph: Graph, nodeId: string): Set<string> {
  const out = new Set<string>()
  if (!graph.nodes[nodeId]) return out
  out.add(nodeId)
  for (const e of Object.values(graph.edges)) {
    if (e.source === nodeId) out.add(e.target)
    else if (e.target === nodeId) out.add(e.source)
  }
  return out
}

/* ── Filtering ──────────────────────────────────────────────────────────── */

export interface GraphFilter {
  /** Kinds to KEEP. Omitted → every kind. The root is always kept. */
  kinds?: ReadonlySet<string> | readonly string[]
  /** Case-insensitive substring over label + sublabel. Omitted/blank → all. */
  query?: string
}

const norm = (s: string) => s.trim().toLowerCase()

const nodeMatches = (n: GraphNode, q: string): boolean =>
  !q || n.label.toLowerCase().includes(q) || n.sublabel.toLowerCase().includes(q)

/** Nodes of the allowed kinds (and matching the query) with the edges that
 *  survive between them. Returns a new graph; degrees are recounted. */
export function filterGraph(graph: Graph, filter: GraphFilter = {}): Graph {
  const kinds = filter.kinds ? new Set(filter.kinds) : null
  const q = norm(filter.query ?? '')
  const g: Graph = { nodes: {}, edges: { ...graph.edges }, root: graph.root }
  for (const [id, n] of Object.entries(graph.nodes)) {
    const isRoot = id === graph.root
    if (!isRoot && kinds && !kinds.has(n.kind)) continue
    if (!isRoot && !nodeMatches(n, q)) continue
    g.nodes[id] = { ...n }
  }
  return settle(g)
}

/** Ids whose label/sublabel contain the query (for highlighting rather than
 *  filtering). Blank query → empty set. */
export function matchingNodeIds(graph: Graph, query: string): Set<string> {
  const q = norm(query)
  const out = new Set<string>()
  if (!q) return out
  for (const [id, n] of Object.entries(graph.nodes)) if (nodeMatches(n, q)) out.add(id)
  return out
}

/** Node counts per kind — over the nodes actually present, nothing else. */
export function kindCounts(graph: Graph): Partial<Record<GraphNodeKind, number>> {
  const out: Partial<Record<GraphNodeKind, number>> = {}
  for (const n of Object.values(graph.nodes)) out[n.kind] = (out[n.kind] ?? 0) + 1
  return out
}

/** The kinds present, in vocabulary order (legend / chips render only these). */
export function presentKinds(graph: Graph): GraphNodeKind[] {
  const c = kindCounts(graph)
  return GRAPH_NODE_KINDS.filter((k) => (c[k] ?? 0) > 0)
}

/* ── Renderer bridge ────────────────────────────────────────────────────── */

export interface GraphElementData {
  id: string
  [key: string]: string | number | boolean | null
}
/** Structurally what `cytoscape.ElementDefinition` needs — declared here so
 *  the pure model never imports the renderer. */
export interface GraphElement {
  group: 'nodes' | 'edges'
  data: GraphElementData
  classes?: string
}

export function toCytoscapeElements(graph: Graph): GraphElement[] {
  const out: GraphElement[] = []
  for (const n of Object.values(graph.nodes)) {
    out.push({
      group: 'nodes',
      data: {
        id: n.id, kind: n.kind, refId: n.refId, label: n.label, sublabel: n.sublabel,
        depth: n.depth, degree: n.degree, color: GRAPH_KIND_META[n.kind].color, isRoot: n.id === graph.root,
      },
      classes: n.id === graph.root ? `kind-${n.kind} root` : `kind-${n.kind}`,
    })
  }
  for (const e of Object.values(graph.edges)) {
    out.push({
      group: 'edges',
      data: {
        id: e.id, source: e.source, target: e.target, kind: e.kind, label: e.label,
        confidence: e.confidence, provenance: e.provenance,
      },
    })
  }
  return out
}

/* ── Deep links ─────────────────────────────────────────────────────────── */

const REGISTRY_TOOL: Partial<Record<GraphNodeKind, ToolId>> = {
  person: 'persons', vehicle: 'vehicles', gang: 'gangs', place: 'places', narcotic: 'narcotics', account: 'accounts',
}

/** The one href per node kind. Registry kinds open in the workspace (a
 *  record tab where the tool has one, else the tool's own list seed param);
 *  evidence and reports need the case they belong to — without it there is
 *  no link (null), never a guess. */
export function nodeHref(kind: GraphNodeKind, id: string, opts: { caseId?: string | null } = {}): string | null {
  const enc = encodeURIComponent
  switch (kind) {
    case 'case':
      return caseLink(id)
    case 'external_source':
      return `/intelligence?source=${enc(id)}`
    case 'evidence':
      return opts.caseId ? caseLink(opts.caseId, 'media', { media: id }) : null
    case 'report':
      return opts.caseId ? caseLink(opts.caseId, 'reports', { report: id }) : null
    default: {
      const tool = REGISTRY_TOOL[kind]
      if (!tool) return null
      if (hasRecordTabs(tool)) return `/workspace?tool=${tool}&record=${enc(id)}`
      const param = RECORD_PARAM[tool]
      return param ? `/workspace?tool=${tool}&${param}=${enc(id)}` : `/workspace?tool=${tool}`
    }
  }
}

/** The case a non-case node belongs to, as far as the loaded graph knows:
 *  the graph's own root when that is a case, else an adjacent case node. */
export function caseIdFor(graph: Graph, nodeId: string): string | null {
  const root = graph.root ? graph.nodes[graph.root] : null
  if (root?.kind === 'case') return root.refId
  for (const other of neighbourhood(graph, nodeId)) {
    const n = graph.nodes[other]
    if (n && n.kind === 'case') return n.refId
  }
  return null
}

/** savedViews section key for a root — one view list per charted record. */
export const graphViewKey = (rootKind: string, rootId: string): string => `graph:${rootKind}:${rootId}`

/** What a saved graph view stores (lib/savedViews config — opaque there). */
export interface GraphViewConfig {
  depth: number
  /** Kinds hidden by the chips. */
  hiddenKinds: string[]
  edgeLabels: boolean
  /** Dragged node positions by canvas id (rounded; capped by the saver). */
  positions: Record<string, { x: number; y: number }>
}

export const MAX_SAVED_POSITIONS = 300

/** Parse an opaque saved config back into a GraphViewConfig, dropping
 *  garbage — a stale or hand-edited row must never crash the canvas. */
export function parseGraphViewConfig(raw: unknown): GraphViewConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<Record<keyof GraphViewConfig, unknown>>
  const depth = typeof r.depth === 'number' && r.depth >= 1 && r.depth <= 3 ? Math.round(r.depth) : 1
  const hiddenKinds = Array.isArray(r.hiddenKinds) ? r.hiddenKinds.filter(isGraphNodeKind) : []
  const edgeLabels = r.edgeLabels === true
  const positions: GraphViewConfig['positions'] = {}
  if (r.positions && typeof r.positions === 'object') {
    for (const [id, p] of Object.entries(r.positions as Record<string, unknown>)) {
      const pos = p as { x?: unknown; y?: unknown } | null
      if (pos && typeof pos.x === 'number' && typeof pos.y === 'number' && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
        positions[id] = { x: Math.round(pos.x), y: Math.round(pos.y) }
      }
    }
  }
  return { depth, hiddenKinds, edgeLabels, positions }
}
