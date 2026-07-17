'use client'

/** Investigation Graph — case-centered link chart (i2/Maltego-style).
 *  Nodes come from data the case already has: intel links (persons with
 *  their roles, gangs, places), evidence, reports & warrant reports, and
 *  vehicles connected by ownership or by their plate appearing in evidence
 *  text. Edges carry the relationship (owns, seen at, linked to, mentioned
 *  in, member of, …). Click a node for a details side panel with deep links.
 *  Expand a person's other cases; dragged layouts persist per case on this
 *  device. READ-ONLY over the links: the one place intel is linked/unlinked
 *  is the Intel & Notes tab (the "Manage links" affordance points there).
 *  Derived edges (vehicle plate/name substring matches — never persisted
 *  rows) render dashed so inference is never mistaken for recorded intel.
 *  All queries are RLS-scoped; no new backend. */
import '@xyflow/react/dist/style.css'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import type { Tables } from '@/lib/database.types'
import { list } from '@/lib/db'
import { caseLink } from '@/lib/caseLinks'
import { timeAgo } from '@/lib/format'
import { WARRANT_TPLS, reportTitle, warrantStatusOf, type ReportLike } from '@/lib/forms'
import { officerName } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { caseStatusTint } from '@/lib/signoff'
import { Store } from '@/lib/store'
import { toast } from '@/lib/toast'

type CaseRow = Tables<'cases'>
type LinkRow = Tables<'case_intel_links'>
type PersonRow = Tables<'persons'>
type GangRow = Tables<'gangs'>
type PlaceRow = Tables<'places'>
type VehicleRow = Tables<'vehicles'>
type EvidenceRow = Tables<'evidence'>
type ReportRow = Tables<'reports'>
type MediaLite = Pick<Tables<'media'>, 'id' | 'report_id' | 'vehicle_id' | 'archived_at'>

type Kind = 'case' | 'person' | 'gang' | 'place' | 'vehicle' | 'evidence' | 'media' | 'report' | 'warrant'

interface NodeData extends Record<string, unknown> {
  kind: Kind
  icon: string
  label: string
  sub: string
  /** Detail rows for the side panel. */
  fields: [string, string][]
  href?: string
  hrefLabel?: string
  /** Source entity id (person/gang/place) — enables Expand for persons. */
  refId?: string
}

const KIND_TINT: Record<Kind, string> = {
  case: 'border-blue-400/60 bg-blue-500/15 text-blue-100',
  person: 'border-amber-400/50 bg-amber-500/10 text-amber-100',
  gang: 'border-rose-400/50 bg-rose-500/10 text-rose-100',
  place: 'border-emerald-400/50 bg-emerald-500/10 text-emerald-100',
  vehicle: 'border-cyan-400/50 bg-cyan-500/10 text-cyan-100',
  evidence: 'border-violet-400/50 bg-violet-500/10 text-violet-100',
  media: 'border-fuchsia-400/50 bg-fuchsia-500/10 text-fuchsia-100',
  report: 'border-slate-400/40 bg-white/5 text-slate-200',
  warrant: 'border-yellow-400/60 bg-yellow-500/10 text-yellow-100',
}

/** All edges connect node centers (invisible handles) so the radial layout
 *  reads like a link chart, not a flowchart. */
function GraphNode({ data, selected }: NodeProps<Node<NodeData>>) {
  const centered = { left: '50%', top: '50%', transform: 'translate(-50%,-50%)', opacity: 0, pointerEvents: 'none' as const }
  return (
    <div className={`max-w-44 rounded-xl border px-3 py-2 shadow-lg transition ${KIND_TINT[data.kind]} ${selected ? 'ring-2 ring-white/60' : ''}`}>
      <Handle type="target" position={Position.Top} style={centered} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} style={centered} isConnectable={false} />
      <p className="truncate text-xs font-black"><span aria-hidden>{data.icon}</span> {data.label}</p>
      {data.sub && <p className="truncate text-[10px] opacity-70">{data.sub}</p>}
    </div>
  )
}
const nodeTypes = { intel: GraphNode }

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase()

interface OtherCase { id: string; case_number: string; title: string | null; status: string }

export function CaseGraphTab({ c }: { c: CaseRow }) {
  const layoutKey = `graphLayout:${c.id}`
  const [data, setData] = useState<{
    links: LinkRow[]; persons: PersonRow[]; gangs: GangRow[]; places: PlaceRow[]
    vehicles: VehicleRow[]; evidence: EvidenceRow[]; reports: ReportRow[]; media: MediaLite[]
  } | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [savedPos, setSavedPos] = useState<Record<string, { x: number; y: number }>>(() => Store.get(layoutKey, {}))
  const [expanded, setExpanded] = useState<Record<string, OtherCase[]>>({})
  const [expandBusy, setExpandBusy] = useState<string | null>(null)
  const vLinks = useTableVersion('case_intel_links')
  const vEvidence = useTableVersion('evidence')
  const vReports = useTableVersion('reports')
  const vMedia = useTableVersion('media')

  // Persist dragged positions (skip the empty object so a fresh mount or a
  // just-reset layout doesn't write a useless entry).
  useEffect(() => {
    if (Object.keys(savedPos).length) Store.set(layoutKey, savedPos)
  }, [savedPos, layoutKey])

  const onDragStop = useCallback((_e: unknown, n: Node) => {
    setSavedPos((prev) => ({ ...prev, [n.id]: { x: Math.round(n.position.x), y: Math.round(n.position.y) } }))
  }, [])

  const resetLayout = () => {
    Store.set(layoutKey, {})
    setSavedPos({})
  }

  const expandPerson = async (pid: string) => {
    setExpandBusy(pid)
    try {
      const links = await list('case_intel_links', { eq: { kind: 'person', ref_id: pid } })
      const ids = [...new Set(links.map((l) => l.case_id).filter((id) => id !== c.id))]
      const cases = ids.length
        ? ((await list('cases', { select: 'id,case_number,title,status', in: { id: ids } })) as unknown as OtherCase[])
        : []
      setExpanded((prev) => ({ ...prev, [pid]: cases }))
      if (!cases.length) toast('No other cases for this person (that you can see).', 'info')
    } catch (e) {
      toast(`Could not load their cases: ${e instanceof Error ? e.message : String(e)}`, 'danger')
    } finally {
      setExpandBusy(null)
    }
  }

  const refresh = useCallback(async () => {
    try {
      const [links, persons, gangs, places, vehicles, evidence, reports, media] = await Promise.all([
        list('case_intel_links', { eq: { case_id: c.id } }),
        list('persons', {}).catch(() => [] as PersonRow[]),
        list('gangs', {}).catch(() => [] as GangRow[]),
        list('places', {}).catch(() => [] as PlaceRow[]),
        list('vehicles', {}).catch(() => [] as VehicleRow[]),
        list('evidence', { eq: { case_id: c.id } }).catch(() => [] as EvidenceRow[]),
        list('reports', { eq: { case_id: c.id } }).catch(() => [] as ReportRow[]),
        list('media', { select: 'id,report_id,vehicle_id,archived_at', eq: { case_id: c.id } })
          .then((r) => r as unknown as MediaLite[]).catch(() => [] as MediaLite[]),
      ])
      setData({ links, persons, gangs, places, vehicles, evidence, reports, media })
    } catch { setData({ links: [], persons: [], gangs: [], places: [], vehicles: [], evidence: [], reports: [], media: [] }) }
  }, [c.id])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, vLinks, vEvidence, vReports, vMedia])

  const graph = useMemo(() => {
    if (!data) return { nodes: [] as Node<NodeData>[], edges: [] as Edge[] }
    const nodes: Node<NodeData>[] = []
    const edges: Edge[] = []
    // `dashed` marks a DERIVED edge (render-time inference, not a stored
    // link row) so it reads visually apart from recorded relationships.
    const edge = (source: string, target: string, label: string, tone = '#64748b', dashed = false) => {
      edges.push({
        id: `${source}→${target}:${label}`,
        source, target, label,
        type: 'straight',
        style: { stroke: tone, strokeWidth: 1.2, opacity: 0.7, ...(dashed ? { strokeDasharray: '6 4' } : {}) },
        labelStyle: { fill: '#94a3b8', fontSize: 9, fontWeight: 700, textTransform: 'uppercase' },
        labelBgStyle: { fill: '#0b1120', fillOpacity: 0.85 },
      })
    }

    // ---- resolve the case's direct neighbours -----------------------------
    const personById = new Map(data.persons.map((p) => [p.id, p]))
    const gangById = new Map(data.gangs.map((g) => [g.id, g]))
    const placeById = new Map(data.places.map((p) => [p.id, p]))

    interface Direct { id: string; data: NodeData; edgeLabel: string; edgeTone?: string }
    const direct: Direct[] = []

    // Reports & warrants (top of the ring)
    for (const r of data.reports) {
      const isWarrant = !!WARRANT_TPLS[r.template]
      const rl = r as unknown as ReportLike
      direct.push({
        id: `report:${r.id}`,
        edgeLabel: isWarrant ? 'warrant filed' : 'filed',
        edgeTone: isWarrant ? '#eab308' : undefined,
        data: {
          kind: isWarrant ? 'warrant' : 'report',
          icon: isWarrant ? '⚖️' : '📄',
          label: reportTitle(rl),
          sub: isWarrant ? `status: ${warrantStatusOf(rl)}` : (r.finalized ? 'finalized' : 'draft'),
          fields: [
            ['Author', officerName(r.author_id) || 'Officer'],
            ['Updated', timeAgo(r.updated_at)],
            ...(isWarrant ? [['Warrant status', warrantStatusOf(rl)] as [string, string]] : [['Finalized', r.finalized ? 'yes' : 'no'] as [string, string]]),
          ],
          href: caseLink(c.id, 'reports', { report: r.id }),
          hrefLabel: 'Open report',
        },
      })
    }

    // Intel links: persons (suspects/witnesses via role), gangs, places
    const linkedPersons: PersonRow[] = []
    const linkedGangIds = new Set<string>()
    for (const l of data.links) {
      if (l.kind === 'person') {
        const p = personById.get(l.ref_id)
        if (!p) continue
        linkedPersons.push(p)
        direct.push({
          id: `person:${p.id}`,
          edgeLabel: l.role || 'linked to',
          edgeTone: norm(l.role).includes('suspect') ? '#f43f5e' : undefined,
          data: {
            kind: 'person', icon: '👤', label: p.name || 'Person',
            refId: p.id,
            sub: [l.role, p.alias ? `“${p.alias}”` : ''].filter(Boolean).join(' · '),
            fields: [
              ['Role in case', l.role || '—'],
              ['Alias', p.alias || '—'],
              ['Status', p.status || '—'],
              ['Gang', (p.gang_id && gangById.get(p.gang_id)?.name) || '—'],
              ['Felonies', String(p.felony_count ?? 0)],
              ...(l.note ? [['Link note', l.note] as [string, string]] : []),
            ],
            href: `/persons?q=${encodeURIComponent(p.name ?? '')}`, hrefLabel: 'Open in Persons',
          },
        })
      } else if (l.kind === 'gang') {
        const g = gangById.get(l.ref_id)
        if (!g) continue
        linkedGangIds.add(g.id)
        direct.push({
          id: `gang:${g.id}`,
          edgeLabel: l.role || 'associated with',
          edgeTone: '#f43f5e',
          data: {
            kind: 'gang', icon: '🏴', label: g.name,
            refId: g.id,
            sub: g.threat_level ? `threat: ${g.threat_level}` : 'organization',
            fields: [
              ['Threat level', String(g.threat_level ?? '—')],
              ['Colors', g.colors || '—'],
              ...(l.note ? [['Link note', l.note] as [string, string]] : []),
            ],
            href: `/gangs?q=${encodeURIComponent(g.name)}`, hrefLabel: 'Open in Gangs',
          },
        })
      } else if (l.kind === 'place') {
        const p = placeById.get(l.ref_id)
        if (!p) continue
        direct.push({
          id: `place:${p.id}`,
          edgeLabel: l.role || 'linked to',
          data: {
            kind: 'place', icon: '📍', label: p.name,
            refId: p.id,
            sub: [p.type, p.area].filter(Boolean).join(' · '),
            fields: [
              ['Type', p.type || '—'],
              ['Area', p.area || '—'],
              ['Controlled by', (p.controlling_gang_id && gangById.get(p.controlling_gang_id)?.name) || '—'],
              ...(l.note ? [['Link note', l.note] as [string, string]] : []),
            ],
            href: '/places', hrefLabel: 'Open in Places',
          },
        })
      }
    }

    // Legacy evidence (frozen table — read-only rows on the media tab)
    for (const e of data.evidence) {
      direct.push({
        id: `evidence:${e.id}`,
        edgeLabel: 'logged',
        data: {
          kind: 'evidence', icon: '🧾', label: e.item_code || 'Evidence',
          sub: [e.type, e.location].filter(Boolean).join(' · '),
          fields: [
            ['Type', e.type || '—'],
            ['Location', e.location || '—'],
            ['Collected', e.collected_at ? timeAgo(e.collected_at) : '—'],
            ['Chain', String(e.tamper ?? 'ok')],
            ['Description', (e.description || '—').slice(0, 140)],
          ],
          href: caseLink(c.id, 'media', { evidence: e.id }), hrefLabel: 'Open legacy evidence',
        },
      })
    }

    // Case media — ONE grouped node (no per-photo nodes, no caption-inferred
    // edges); typed-FK edges to reports/vehicles land after those nodes exist.
    const liveMedia = data.media.filter((m) => !m.archived_at)
    if (liveMedia.length) {
      direct.push({
        id: 'case-media',
        edgeLabel: 'photos & media',
        edgeTone: '#e879f9',
        data: {
          kind: 'media', icon: '🖼️', label: `Case media (${liveMedia.length})`,
          sub: 'photos, clips & documents',
          fields: [
            ['Items', String(liveMedia.length)],
            ['Linked to reports', String(liveMedia.filter((m) => m.report_id).length)],
          ],
          href: caseLink(c.id, 'media'), hrefLabel: 'Open Photos & Media',
        },
      })
    }

    // ---- center + ring layout --------------------------------------------
    nodes.push({
      id: 'case', type: 'intel', position: { x: 0, y: 0 },
      data: {
        kind: 'case', icon: '📂', label: c.case_number, sub: c.title || 'Untitled',
        fields: [
          ['Status', c.status], ['Bureau', c.bureau], ['Area', c.area || '—'],
          ['Lead', officerName(c.lead_detective_id) || 'Unassigned'],
          ['Summary', (c.summary || '—').slice(0, 200)],
        ],
      },
      draggable: false,
    })
    const R = 320
    direct.forEach((d, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(direct.length, 1)
      nodes.push({ id: d.id, type: 'intel', position: { x: Math.round(R * Math.cos(angle)), y: Math.round(R * Math.sin(angle)) }, data: d.data })
      edge('case', d.id, d.edgeLabel, d.edgeTone)
    })
    const angleOf = (id: string) => {
      const n = nodes.find((x) => x.id === id)
      return n ? Math.atan2(n.position.y, n.position.x) : 0
    }

    // ---- second ring: vehicles + cross-links ------------------------------
    const evidenceText = data.evidence.map((e) => norm([e.description, e.notes, e.location].filter(Boolean).join(' ')))
    const caseText = norm(c.summary)
    const addedVehicles = new Set<string>()
    const addVehicle = (v: VehicleRow, anchorId: string, label: string) => {
      const nodeId = `vehicle:${v.id}`
      if (!addedVehicles.has(nodeId)) {
        addedVehicles.add(nodeId)
        const a = angleOf(anchorId) + 0.18
        nodes.push({
          id: nodeId, type: 'intel',
          position: { x: Math.round(560 * Math.cos(a)), y: Math.round(560 * Math.sin(a)) },
          data: {
            kind: 'vehicle', icon: '🚗', label: v.plate,
            sub: [v.model, v.color].filter(Boolean).join(' · '),
            fields: [
              ['Model', v.model || '—'], ['Color', v.color || '—'],
              ['Owner', (v.owner_id && personById.get(v.owner_id)?.name) || '—'],
              ['Gang', (v.gang_id && gangById.get(v.gang_id)?.name) || '—'],
            ],
            href: `/vehicles?q=${encodeURIComponent(v.plate)}`, hrefLabel: 'Open in Vehicles',
          },
        })
      }
      // Vehicle edges are inference (ownership join / plate substring), not
      // stored links — dashed keeps them visually apart from recorded intel.
      edge(anchorId, nodeId, label, '#22d3ee', true)
    }
    for (const v of data.vehicles) {
      if (v.owner_id && linkedPersons.some((p) => p.id === v.owner_id)) addVehicle(v, `person:${v.owner_id}`, 'owns')
      const plate = norm(v.plate)
      if (plate) {
        const ei = evidenceText.findIndex((t) => t.includes(plate))
        if (ei >= 0) addVehicle(v, `evidence:${data.evidence[ei].id}`, 'seen at')
        else if (caseText.includes(plate)) addVehicle(v, 'case', 'seen at')
      }
    }

    // Media → report/vehicle edges: typed FK columns ONLY, and only when the
    // linked entity is already on the chart.
    if (liveMedia.length) {
      for (const rid of new Set(liveMedia.map((m) => m.report_id).filter((x): x is string => !!x))) {
        if (nodes.some((n) => n.id === `report:${rid}`)) edge('case-media', `report:${rid}`, 'report media', '#8b5cf6')
      }
      for (const vid of new Set(liveMedia.map((m) => m.vehicle_id).filter((x): x is string => !!x))) {
        if (nodes.some((n) => n.id === `vehicle:${vid}`)) edge('case-media', `vehicle:${vid}`, 'depicts', '#22d3ee')
      }
    }

    // person → gang membership (both already on the chart)
    for (const p of linkedPersons) {
      if (p.gang_id && linkedGangIds.has(p.gang_id)) edge(`person:${p.id}`, `gang:${p.gang_id}`, 'member of', '#f43f5e')
    }
    // evidence text mentioning a linked person → "mentioned in" (substring
    // inference — dashed, same as the vehicle matches)
    for (const p of linkedPersons) {
      const name = norm(p.name)
      if (name.length < 4) continue
      data.evidence.forEach((e, i) => {
        if (evidenceText[i].includes(name)) edge(`person:${p.id}`, `evidence:${e.id}`, 'mentioned in', '#a78bfa', true)
      })
    }

    // ---- expanded persons: their other cases (outer ring) ------------------
    for (const [pid, others] of Object.entries(expanded)) {
      const anchor = `person:${pid}`
      if (!nodes.some((n) => n.id === anchor)) continue
      const base = angleOf(anchor)
      others.forEach((oc, i) => {
        const nodeId = `othercase:${oc.id}`
        if (!nodes.some((n) => n.id === nodeId)) {
          const a = base + (i - (others.length - 1) / 2) * 0.22
          nodes.push({
            id: nodeId, type: 'intel',
            position: { x: Math.round(620 * Math.cos(a)), y: Math.round(620 * Math.sin(a)) },
            data: {
              kind: 'case', icon: '📂', label: oc.case_number, sub: oc.title || 'Untitled',
              fields: [['Status', oc.status], ['Title', oc.title || '—']],
              href: caseLink(oc.id), hrefLabel: 'Open case',
            },
          })
        }
        edge(anchor, nodeId, 'also in', '#f59e0b')
      })
    }

    // Dragged layout (persisted per case on this device) wins over the
    // computed radial positions; the center case node stays pinned.
    for (const n of nodes) {
      const p = savedPos[n.id]
      if (p && n.id !== 'case') n.position = p
    }

    return { nodes, edges }
  }, [data, c, expanded, savedPos])

  const selData = useMemo(() => graph.nodes.find((n) => n.id === sel)?.data ?? null, [graph, sel])

  if (!data) return <p className="py-10 text-center text-sm text-slate-500">Building the link chart…</p>
  if (graph.nodes.length <= 1) {
    return (
      <div className="rounded-xl border border-white/10 bg-ink-950/50 p-8 text-center text-sm text-slate-400">
        Nothing to chart yet — link persons, gangs or places on the <b>Intel &amp; Notes</b> tab, or add case photos and reports, and they appear here automatically.
      </div>
    )
  }

  return (
    <div className="relative h-[70vh] overflow-hidden rounded-xl border border-white/10 bg-ink-950/60">
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2}
        maxZoom={2}
        nodesConnectable={false}
        edgesFocusable={false}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, n) => setSel(n.id)}
        onPaneClick={() => setSel(null)}
        onNodeDragStop={onDragStop}
        colorMode="dark"
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#1e293b" />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>

      <div className="absolute left-2 top-2 flex gap-2">
        {/* The graph is a read-only view of the links — editing lives in ONE
            place (Intel & Notes), so there is exactly one insert/unlink rule. */}
        <Link href={caseLink(c.id, 'intel')} className="rounded-lg border border-white/10 bg-ink-900/90 px-2.5 py-1.5 text-xs font-semibold text-slate-200 shadow-lg backdrop-blur transition hover:bg-white/10">
          Manage links → Intel &amp; Notes
        </Link>
        {Object.keys(savedPos).length > 0 && (
          <button onClick={resetLayout} title="Forget the dragged layout and rebuild the radial chart" className="rounded-lg border border-white/10 bg-ink-900/90 px-2.5 py-1.5 text-xs font-semibold text-slate-200 shadow-lg backdrop-blur transition hover:bg-white/10">
            ↺ Reset layout
          </button>
        )}
      </div>

      {selData && (
        <aside className="absolute right-2 top-2 bottom-2 w-72 overflow-y-auto rounded-xl border border-white/10 bg-ink-900/95 p-4 shadow-2xl backdrop-blur">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className={`rounded-lg border px-2.5 py-1.5 ${KIND_TINT[selData.kind]}`}>
              <p className="text-sm font-black"><span aria-hidden>{selData.icon}</span> {selData.label}</p>
              {selData.sub && <p className="text-[11px] opacity-70">{selData.sub}</p>}
            </div>
            <button onClick={() => setSel(null)} aria-label="Close details" className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs font-semibold text-slate-300 hover:bg-white/10">✕</button>
          </div>
          {selData.kind === 'case' && <span className={`mb-2 inline-block rounded px-2 py-0.5 text-[10px] font-black uppercase ${caseStatusTint(c.status)}`}>{c.status}</span>}
          <dl className="space-y-2">
            {selData.fields.map(([k, v]) => (
              <div key={k}>
                <dt className="text-[10px] font-black uppercase tracking-wider text-slate-500">{k}</dt>
                <dd className="text-sm text-slate-200">{v}</dd>
              </div>
            ))}
          </dl>
          {selData.href && (
            <Link href={selData.href} className="mt-4 block rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-3 py-2 text-center text-sm font-bold text-white shadow-glow hover:brightness-110">
              {selData.hrefLabel ?? 'Open'} →
            </Link>
          )}
          {selData.kind === 'person' && selData.refId && !(selData.refId in expanded) && (
            <button
              onClick={() => void expandPerson(selData.refId!)}
              disabled={expandBusy === selData.refId}
              className="mt-2 block w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-center text-sm font-semibold text-slate-200 transition hover:bg-white/10 disabled:opacity-60"
            >
              {expandBusy === selData.refId ? 'Looking them up…' : '🕸 Show their other cases'}
            </button>
          )}
          {selData.kind === 'person' && selData.refId && (expanded[selData.refId]?.length === 0) && (
            <p className="mt-2 text-center text-xs text-slate-500">No other visible cases.</p>
          )}
        </aside>
      )}

      <p className="pointer-events-none absolute bottom-2 right-3 text-[10px] text-slate-600">drag to arrange (kept per case) · scroll to zoom · click a node for details</p>
    </div>
  )
}
