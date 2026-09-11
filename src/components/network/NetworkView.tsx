'use client'

/** Investigation Graph — the analysis tool page. A root picker (the shared
 *  EntityPicker, RLS-scoped `entity_suggest`) and the one Cytoscape surface
 *  (InvestigationGraph over `graph_expand`). This replaced the hand-rolled
 *  SVG network that pulled nine whole registries into the browser: nothing
 *  loads until a root is chosen, and everything that loads is what the RPC
 *  returned for this viewer at the chosen depth.
 *
 *  Deep links: `?root=<kind>:<id>` (new) and the legacy `?focus=g:<id>|
 *  p:<id>|n:<id>` (gang / person / narcotic) both open the graph centred on
 *  that record. */
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import type { EntityHit } from '@/lib/entitySearch'
import { isGraphNodeKind, type GraphNodeKind } from '@/lib/graphModel'
import { EntityPicker } from '@/components/entity'
import { InvestigationGraph } from '@/components/graph/InvestigationGraph'
import { Card } from '@/components/ui/Card'
import { Field, Select } from '@/components/ui/Field'
import { EmptyState, Notice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'

type RootKind = 'person' | 'vehicle' | 'gang' | 'place' | 'narcotic' | 'case'

const ROOT_KINDS: ReadonlyArray<{ id: RootKind; label: string }> = [
  { id: 'person', label: 'Person' },
  { id: 'vehicle', label: 'Vehicle' },
  { id: 'gang', label: 'Gang' },
  { id: 'place', label: 'Place' },
  { id: 'narcotic', label: 'Narcotic' },
  { id: 'case', label: 'Case' },
]

const LEGACY_FOCUS: Record<string, RootKind> = { g: 'gang', p: 'person', n: 'narcotic' }

interface Root { kind: GraphNodeKind; id: string }

/** `?root=kind:id` first, then the legacy `?focus=` spelling. */
function rootFromParams(root: string | null, focus: string | null): Root | null {
  if (root) {
    const i = root.indexOf(':')
    const kind = root.slice(0, i), id = root.slice(i + 1)
    if (i > 0 && isGraphNodeKind(kind) && id) return { kind, id }
  }
  if (focus) {
    const i = focus.indexOf(':')
    const kind = LEGACY_FOCUS[focus.slice(0, i)], id = focus.slice(i + 1)
    if (kind && id) return { kind, id }
  }
  return null
}

export function NetworkView() {
  const { state } = useAuth()
  const sp = useSearchParams()
  const seeded = useMemo(() => rootFromParams(sp.get('root'), sp.get('focus')), [sp])
  const [kind, setKind] = useState<RootKind>(() => (seeded && seeded.kind !== 'external_source' && seeded.kind !== 'evidence'
    && seeded.kind !== 'report' && seeded.kind !== 'account' ? seeded.kind : 'person'))
  const [picked, setPicked] = useState<EntityHit | null>(null)
  const [root, setRoot] = useState<Root | null>(seeded)

  // A deep link that arrives while mounted (workspace tab re-activation).
  useEffect(() => {
    if (!seeded) return
    const t = window.setTimeout(() => setRoot(seeded), 0)
    return () => window.clearTimeout(t)
  }, [seeded])

  if (state !== 'in') return <Notice text="Sign in to chart relationships." />

  return (
    <div className="space-y-5">
      <PageHeader
        title="Investigation Graph"
        subtitle="Chart what links a person, vehicle, gang, place, narcotic or case — only records you can already see, one hop at a time."
      />

      <Card pad="sm">
        <div className="grid gap-3 md:grid-cols-[10rem_minmax(0,1fr)]">
          <Field label="Start from">
            {(id) => (
              <Select id={id} value={kind} onChange={(e) => { setKind(e.target.value as RootKind); setPicked(null) }}>
                {ROOT_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
              </Select>
            )}
          </Field>
          <EntityPicker
            // Remount per kind so a kind switch never shows the previous kind's rows.
            key={kind}
            kind={kind}
            label="Record"
            value={picked}
            onChange={(hit) => {
              setPicked(hit)
              if (hit) setRoot({ kind, id: hit.id })
            }}
            placeholder={`Search ${ROOT_KINDS.find((k) => k.id === kind)?.label.toLowerCase() ?? 'record'}s…`}
          />
        </div>
      </Card>

      {root ? (
        <InvestigationGraph key={`${root.kind}:${root.id}`} root={root} height={600} defaultDepth={2} />
      ) : (
        <EmptyState
          title="Pick a record to chart"
          hint="Search for a person, vehicle, gang, place, narcotic or case above. The graph shows what links to it — expand any node to go further."
        />
      )}
    </div>
  )
}
