'use client'

/** Contextual help — the documents that govern the screen you are on.
 *
 *  A screen renders this and names its route. It does not maintain a list of
 *  relevant policies and never needs updating when one is written: documents
 *  declare their own relevance through a route relation, and this asks who
 *  declared it.
 *
 *  RENDERS NOTHING when no document has claimed the route. That is the norm
 *  today — fifteen documents, and until somebody links them this is invisible
 *  everywhere. An empty "Related policies" heading on every screen in the
 *  portal would be worse than silence.
 *
 *  Nothing here widens access: a relation is readable only through its owning
 *  document, so a policy you could not open does not appear.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { list } from '@/lib/db'
import { documentsForRoute, relationLabel, type RelationRow } from '@/lib/docRelations'
import { docTitle } from './docModel'
import { Badge } from '@/components/ui/Badge'

interface DocLite { id: string; name: string; status: string; document_type: string }

export function RelatedGuidance({ route, className }: { route: string; className?: string }) {
  const [rows, setRows] = useState<{ rel: RelationRow; doc: DocLite }[]>([])

  useEffect(() => {
    let alive = true
    const t = window.setTimeout(() => {
      void (async () => {
        const rels = await documentsForRoute(route)
        if (!alive || !rels.length) return
        const ids = [...new Set(rels.map((r) => r.document_id))]
        const docs = await list('documents', {
          in: { id: ids }, select: 'id,name,status,document_type',
        }).catch(() => [])
        if (!alive) return
        const byId = new Map((docs as unknown as DocLite[]).map((d) => [d.id, d]))
        setRows(rels.flatMap((rel) => {
          const doc = byId.get(rel.document_id)
          // A superseded or archived document is not the guidance in force, so
          // it is not offered as if it were.
          if (!doc || doc.status !== 'published') return []
          return [{ rel, doc }]
        }))
      })()
    }, 0)
    return () => { alive = false; window.clearTimeout(t) }
  }, [route])

  if (!rows.length) return null

  return (
    <div className={className}>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        Guidance for this work
      </h3>
      <ul className="mt-1.5 space-y-1">
        {rows.map(({ rel, doc }) => (
          <li key={rel.id} className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="neutral">{relationLabel(rel.relation)}</Badge>
            <Link
              href={`/sops?doc=${doc.id}`}
              className="min-h-[44px] rounded text-slate-200 underline-offset-2 transition hover:text-badge-200 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-badge-500"
            >
              {docTitle(doc.name)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
