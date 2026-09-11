/** Pins for the Investigation Graph model: row folding (dedupe + degree),
 *  progressive merge with the node cap, branch collapse, BFS paths, kind /
 *  query filtering, the renderer bridge and the per-kind deep links. */
import { describe, expect, it } from 'vitest'
import {
  GRAPH_NODE_KINDS, buildGraph, caseIdFor, collapseBranch, edgeLabel, filterGraph, graphViewKey, kindCounts,
  matchingNodeIds, mergeExpansion, neighbourhood, nodeHref, nodeKey, parseGraphViewConfig, presentKinds,
  shortestPath, toCytoscapeElements, type GraphExpandRow,
} from './graphModel'

const C = '11111111-1111-4111-8111-111111111111'
const P1 = '22222222-2222-4222-8222-222222222222'
const P2 = '33333333-3333-4333-8333-333333333333'
const G = '44444444-4444-4444-8444-444444444444'
const V = '55555555-5555-4555-8555-555555555555'
const E = '66666666-6666-4666-8666-666666666666'

const row = (o: Partial<GraphExpandRow> & Pick<GraphExpandRow, 'node_kind' | 'node_id'>): GraphExpandRow => ({
  label: null, sublabel: null, depth: 1, edge_kind: null, from_kind: null, from_id: null, to_kind: null, to_id: null,
  confidence: null, provenance: null, edge_label: null, ...o,
})

/** case ─ p1 ─ gang ─ p2 ; case ─ p2 ; p1 ─ vehicle */
const ROWS: GraphExpandRow[] = [
  row({ node_kind: 'case', node_id: C, label: 'CID-26-0101', sublabel: 'Mock case', depth: 0 }),
  row({ node_kind: 'person', node_id: P1, label: 'John Doe', sublabel: 'Suspect', edge_kind: 'suspect_in', from_kind: 'person', from_id: P1, to_kind: 'case', to_id: C, edge_label: 'Suspect' }),
  row({ node_kind: 'person', node_id: P2, label: 'Jane Roe', edge_kind: 'witness_in', from_kind: 'person', from_id: P2, to_kind: 'case', to_id: C }),
  row({ node_kind: 'gang', node_id: G, label: 'Ballas', depth: 2, edge_kind: 'member_of', from_kind: 'person', from_id: P1, to_kind: 'gang', to_id: G, confidence: 'confirmed' }),
  row({ node_kind: 'gang', node_id: G, label: 'Ballas', depth: 2, edge_kind: 'member_of', from_kind: 'person', from_id: P2, to_kind: 'gang', to_id: G }),
  row({ node_kind: 'vehicle', node_id: V, label: 'ABC 123', depth: 2, edge_kind: 'owns', from_kind: 'person', from_id: P1, to_kind: 'vehicle', to_id: V }),
  // A duplicate of an existing row — must not double anything.
  row({ node_kind: 'person', node_id: P1, label: 'John Doe', edge_kind: 'suspect_in', from_kind: 'person', from_id: P1, to_kind: 'case', to_id: C, edge_label: 'Suspect' }),
]

const k = nodeKey

describe('buildGraph', () => {
  it('dedupes nodes and edges and counts distinct neighbours', () => {
    const g = buildGraph(ROWS)
    expect(Object.keys(g.nodes)).toHaveLength(5)
    expect(Object.keys(g.edges)).toHaveLength(5)
    expect(g.root).toBe(k('case', C))
    expect(g.nodes[k('case', C)].degree).toBe(2)
    expect(g.nodes[k('person', P1)].degree).toBe(3)
    expect(g.nodes[k('gang', G)].degree).toBe(2)
    expect(g.nodes[k('vehicle', V)].depth).toBe(2)
  })

  it('keeps the server edge label over the vocabulary, and falls back to the kind', () => {
    const g = buildGraph(ROWS)
    expect(g.edges[`suspect_in|${k('person', P1)}|${k('case', C)}`].label).toBe('Suspect')
    expect(g.edges[`witness_in|${k('person', P2)}|${k('case', C)}`].label).toBe('witness in')
    expect(edgeLabel('some_new_kind')).toBe('some new kind')
    expect(edgeLabel(null)).toBe('')
  })

  it('ignores kinds the client does not know and dangling edges — nothing is invented', () => {
    const g = buildGraph([
      ...ROWS,
      row({ node_kind: 'ci', node_id: E, label: 'must never render' }),
      row({ node_kind: 'person', node_id: E, label: 'Orphan edge', edge_kind: 'linked_to', from_kind: 'person', from_id: E, to_kind: 'mystery', to_id: C }),
    ])
    expect(Object.keys(g.nodes).some((id) => id.startsWith('ci:'))).toBe(false)
    expect(Object.values(g.edges).every((e) => g.nodes[e.source] && g.nodes[e.target])).toBe(true)
  })

  it('empty rows → empty graph with no root', () => {
    const g = buildGraph([])
    expect(g.root).toBeNull()
    expect(kindCounts(g)).toEqual({})
    expect(presentKinds(g)).toEqual([])
  })

  it('counts only the kinds present, in vocabulary order', () => {
    const g = buildGraph(ROWS)
    expect(kindCounts(g)).toEqual({ case: 1, person: 2, gang: 1, vehicle: 1 })
    expect(presentKinds(g)).toEqual(['case', 'person', 'vehicle', 'gang'])
    expect(GRAPH_NODE_KINDS).toHaveLength(10)
  })
})

describe('mergeExpansion', () => {
  it('layers an expansion in one ring further out and keeps existing depths', () => {
    const g = buildGraph(ROWS)
    const expansion: GraphExpandRow[] = [
      row({ node_kind: 'gang', node_id: G, label: 'Ballas', depth: 0 }),
      row({ node_kind: 'evidence', node_id: E, label: 'EV-000001', depth: 1, edge_kind: 'evidence_of', from_kind: 'evidence', from_id: E, to_kind: 'gang', to_id: G }),
      // Already known at depth 1 — must not be pushed to depth 3.
      row({ node_kind: 'person', node_id: P1, label: 'John Doe', depth: 1, edge_kind: 'member_of', from_kind: 'person', from_id: P1, to_kind: 'gang', to_id: G }),
    ]
    const { graph, added, truncated } = mergeExpansion(g, expansion)
    expect(added).toBe(1)
    expect(truncated).toBe(false)
    expect(graph.nodes[k('evidence', E)].depth).toBe(3)
    expect(graph.nodes[k('person', P1)].depth).toBe(1)
    expect(graph.nodes[k('gang', G)].degree).toBe(3)
    // Immutable: the input graph is untouched.
    expect(g.nodes[k('evidence', E)]).toBeUndefined()
  })

  it('honours the node cap and reports truncation', () => {
    const g = buildGraph(ROWS)
    const expansion: GraphExpandRow[] = [
      row({ node_kind: 'gang', node_id: G, depth: 0 }),
      row({ node_kind: 'evidence', node_id: E, depth: 1, edge_kind: 'evidence_of', from_kind: 'evidence', from_id: E, to_kind: 'gang', to_id: G }),
      row({ node_kind: 'place', node_id: '77777777-7777-4777-8777-777777777777', depth: 1, edge_kind: 'located_at', from_kind: 'gang', from_id: G, to_kind: 'place', to_id: '77777777-7777-4777-8777-777777777777' }),
    ]
    const { graph, added, truncated } = mergeExpansion(g, expansion, 6)
    expect(added).toBe(1)
    expect(truncated).toBe(true)
    expect(Object.keys(graph.nodes)).toHaveLength(6)
  })
})

describe('collapseBranch', () => {
  it('removes only what is reachable exclusively through the node', () => {
    const g = buildGraph(ROWS)
    // p1's branch: vehicle hangs only off p1; the gang is also reachable via p2.
    const c = collapseBranch(g, k('person', P1))
    expect(c.nodes[k('vehicle', V)]).toBeUndefined()
    expect(c.nodes[k('gang', G)]).toBeDefined()
    expect(c.nodes[k('person', P1)]).toBeDefined()
    expect(c.nodes[k('person', P1)].degree).toBe(2)
  })

  it('is a no-op for the root and for unknown nodes', () => {
    const g = buildGraph(ROWS)
    expect(collapseBranch(g, g.root!)).toBe(g)
    expect(collapseBranch(g, 'person:nope')).toBe(g)
  })
})

describe('shortestPath / neighbourhood', () => {
  it('finds the hop-minimal route and the edges walked', () => {
    const g = buildGraph(ROWS)
    const p = shortestPath(g, k('vehicle', V), k('case', C))
    expect(p?.nodes).toEqual([k('vehicle', V), k('person', P1), k('case', C)])
    expect(p?.edges).toHaveLength(2)
    expect(shortestPath(g, k('case', C), k('case', C))).toEqual({ nodes: [k('case', C)], edges: [] })
  })

  it('answers null when disconnected or unknown', () => {
    const g = buildGraph([...ROWS, row({ node_kind: 'place', node_id: E, label: 'Island', depth: 1 })])
    expect(shortestPath(g, k('case', C), k('place', E))).toBeNull()
    expect(shortestPath(g, k('case', C), 'person:missing')).toBeNull()
  })

  it('neighbourhood is the node plus its direct neighbours', () => {
    const g = buildGraph(ROWS)
    expect([...neighbourhood(g, k('person', P1))].sort()).toEqual([k('case', C), k('gang', G), k('person', P1), k('vehicle', V)].sort())
    expect(neighbourhood(g, 'nope').size).toBe(0)
  })
})

describe('filterGraph / matchingNodeIds', () => {
  it('keeps the allowed kinds (root always) and recounts degrees', () => {
    const g = buildGraph(ROWS)
    const f = filterGraph(g, { kinds: ['person'] })
    expect(Object.keys(f.nodes).sort()).toEqual([k('case', C), k('person', P1), k('person', P2)].sort())
    expect(f.nodes[k('person', P1)].degree).toBe(1)
    expect(Object.keys(f.edges)).toHaveLength(2)
  })

  it('query matches label or sublabel, case-insensitively', () => {
    const g = buildGraph(ROWS)
    expect([...matchingNodeIds(g, 'doe')]).toEqual([k('person', P1)])
    expect([...matchingNodeIds(g, 'SUSPECT')]).toEqual([k('person', P1)])
    expect(matchingNodeIds(g, '  ').size).toBe(0)
    expect(Object.keys(filterGraph(g, { query: 'ballas' }).nodes).sort()).toEqual([k('case', C), k('gang', G)].sort())
  })
})

describe('toCytoscapeElements', () => {
  it('emits one node element per node (root flagged) and one edge per edge', () => {
    const g = buildGraph(ROWS)
    const els = toCytoscapeElements(g)
    const nodes = els.filter((e) => e.group === 'nodes')
    const edges = els.filter((e) => e.group === 'edges')
    expect(nodes).toHaveLength(5)
    expect(edges).toHaveLength(5)
    const root = nodes.find((n) => n.data.id === g.root)!
    expect(root.data.isRoot).toBe(true)
    expect(root.classes).toContain('root')
    expect(root.classes).toContain('kind-case')
    expect(typeof root.data.color).toBe('string')
    expect(edges[0].data.source).toBeTruthy()
    expect(edges[0].data.target).toBeTruthy()
  })
})

describe('nodeHref', () => {
  it('spells the one link per kind', () => {
    expect(nodeHref('case', C)).toBe(`/cases?case=${C}`)
    expect(nodeHref('person', P1)).toBe(`/workspace?tool=persons&record=${P1}`)
    expect(nodeHref('vehicle', V)).toBe(`/workspace?tool=vehicles&record=${V}`)
    expect(nodeHref('gang', G)).toBe(`/workspace?tool=gangs&record=${G}`)
    expect(nodeHref('narcotic', G)).toBe(`/workspace?tool=narcotics&record=${G}`)
    // Places have no record tab — the tool's own list seed param.
    expect(nodeHref('place', G)).toBe(`/workspace?tool=places&place=${G}`)
    expect(nodeHref('account', G)).toBe('/workspace?tool=accounts')
    expect(nodeHref('external_source', E)).toBe(`/intelligence?source=${E}`)
  })

  it('evidence and reports need their case — no case, no link', () => {
    expect(nodeHref('evidence', E, { caseId: C })).toBe(`/cases?case=${C}&tab=media&media=${E}`)
    expect(nodeHref('report', E, { caseId: C })).toBe(`/cases?case=${C}&tab=reports&report=${E}`)
    expect(nodeHref('evidence', E)).toBeNull()
    expect(nodeHref('report', E)).toBeNull()
  })

  it('caseIdFor uses the case root, else an adjacent case node', () => {
    const g = buildGraph(ROWS)
    expect(caseIdFor(g, k('vehicle', V))).toBe(C)
    const rooted = buildGraph(ROWS.map((r) => ({ ...r, depth: r.node_id === P1 ? 0 : r.depth })), { kind: 'person', id: P1 })
    expect(rooted.root).toBe(k('person', P1))
    expect(caseIdFor(rooted, k('person', P1))).toBe(C)
    expect(caseIdFor(rooted, k('vehicle', V))).toBeNull()
  })
})

describe('saved views', () => {
  it('graphViewKey is stable per root', () => {
    expect(graphViewKey('case', C)).toBe(`graph:case:${C}`)
  })

  it('parseGraphViewConfig drops garbage and clamps depth', () => {
    expect(parseGraphViewConfig(null)).toBeNull()
    expect(parseGraphViewConfig({ depth: 9, hiddenKinds: ['person', 'ci', 3], edgeLabels: 'yes', positions: { a: { x: 1.4, y: 'no' }, b: { x: 2.6, y: -3 } } }))
      .toEqual({ depth: 1, hiddenKinds: ['person'], edgeLabels: false, positions: { b: { x: 3, y: -3 } } })
    expect(parseGraphViewConfig({ depth: 2, edgeLabels: true })).toEqual({ depth: 2, hiddenKinds: [], edgeLabels: true, positions: {} })
  })
})
