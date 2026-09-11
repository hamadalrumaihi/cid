'use client'

/** Case Graph tab — the Investigation Graph rooted at this case (depth 1 by
 *  default; the depth selector goes to 3). Every node came back from
 *  `graph_expand` under the viewer's own RLS, so the chart shows exactly the
 *  linked persons, vehicles, gangs, places, narcotics, evidence, reports and
 *  external sources this member can already open — and nothing for the rest.
 *
 *  READ-ONLY over the links: the one place intel is linked/unlinked is the
 *  Intel & Notes tab. Dragged layouts persist as saved views (lib/savedViews,
 *  cross-device) rather than this device's localStorage. CaseDetail loads
 *  this module through next/dynamic; the Cytoscape bundle itself sits one
 *  more dynamic import down (graph/GraphCanvas). */
import { InvestigationGraph } from '@/components/graph/InvestigationGraph'
import type { CaseRow } from './tabs/shared'

export function CaseGraphTab({ c }: { c: CaseRow }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">
        Read-only chart of what this case links to. Manage links in the Intel &amp; Notes tab; double-click a node to expand it.
      </p>
      <InvestigationGraph key={c.id} root={{ kind: 'case', id: c.id }} caseId={c.id} height={560} />
    </div>
  )
}
