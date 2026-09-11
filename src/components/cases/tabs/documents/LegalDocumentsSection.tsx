'use client'

/** Legal Documents — the case's warrants and subpoenas as a read-only list.
 *  Only the rows the viewer's RLS-scoped query returned are here: a sealed
 *  request leaves no trace (no count, no placeholder). Filing, review and
 *  the instrument text stay in /legal. */
import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/Notice'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { ScaleIcon } from '@/components/shell/icons'
import type { LegalRequestRow } from '@/lib/documents'
import { fmtDate } from '@/lib/format'

const requestTypeLabel = (t: string): string => t.replace(/_/g, ' ')

export function LegalDocumentsSection({ rows }: { rows: LegalRequestRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ScaleIcon className="h-5 w-5" />}
        title="No legal documents on this case"
        hint="Warrants and subpoenas filed against this case are listed here, with their instrument in the Legal view."
      />
    )
  }
  return (
    <ul className="divide-y divide-white/5 rounded-lg border border-white/10" aria-label="Legal documents">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
          <span className="font-mono text-xs text-badge-200" translate="no">{r.request_number}</span>
          <span className="min-w-0 flex-1 basis-48 truncate text-sm text-white" title={r.title ?? undefined}>{r.title || requestTypeLabel(r.request_type)}</span>
          <Badge>{requestTypeLabel(r.request_type)}</Badge>
          <StatusBadge domain="legalReview" value={r.review_status} />
          {r.classification !== 'standard' && r.classification && <Badge tone="warn">{r.classification}</Badge>}
          <span className="text-xs text-slate-400 tabular-nums">{fmtDate(r.created_at)}</span>
          <Link
            href={`/legal?request=${encodeURIComponent(r.id)}`}
            className="inline-flex min-h-9 items-center rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-medium text-slate-200 transition hover:bg-white/10 lg:min-h-0 lg:py-1.5"
          >
            Open in Legal
          </Link>
        </li>
      ))}
    </ul>
  )
}
