'use client'

/** A dashboard slice of the ONE Action Center queue (Phase 7, P7-06 / AC7).
 *  My Dashboard's "Needs your attention", the Command Center's "Awaiting you"
 *  and the Approval Queue's decisions all render THIS over `useActionQueue()`
 *  — the same items, the same ranking, one fetch — instead of each deriving
 *  its own list from its own table loads. Rows are DashRows inside a
 *  DashPanel; the header action links to the full queue. */
import { Badge } from '@/components/ui/Badge'
import { DashPanel } from '@/components/dash/DashPanel'
import { DashRow } from '@/components/dash/DashRow'
import { useToolNav } from '@/components/tools/useToolNav'
import type { ActionItem } from '@/lib/actionItems'
import { timeAgo } from '@/lib/format'
import { useActionQueue } from './useActionQueue'

export interface ActionSliceProps {
  title: string
  /** Which queue items belong to this slice (over the VISIBLE items). */
  filter: (it: ActionItem) => boolean
  /** Rows rendered; the count chip still shows the whole slice. */
  limit?: number
  /** Quiet line when the slice is empty (the panel stays, so an empty
   *  decision queue reads as "nothing waiting", not as a missing feature). */
  emptyText: string
  /** The full queue, pre-filtered (`/action`, `/action?preset=command`). */
  href: string
  hrefLabel?: string
  /** Optional explanatory line under the title. */
  hint?: string
}

export function ActionSlice({ title, filter, limit = 10, emptyText, href, hrefLabel, hint }: ActionSliceProps) {
  const { items, loading } = useActionQueue()
  const { openHref } = useToolNav()
  const slice = items.filter(filter)
  const shown = slice.slice(0, limit)
  return (
    <DashPanel
      title={title}
      count={slice.length}
      hint={hint}
      action={{ label: hrefLabel ?? `Open Action Center (${slice.length}) →`, href }}
    >
      {shown.map((it) => (
        <DashRow
          key={it.id}
          title={it.title}
          why={it.reason || it.summary}
          meta={it.caseNumber ?? timeAgo(it.updatedAt)}
          overdue={it.status === 'overdue'}
          badge={
            <>
              {it.escalatedAt && <Badge tone="danger" title={`Escalated ${timeAgo(it.escalatedAt)}`}>Escalated</Badge>}
              {it.priority === 'critical'
                ? <Badge tone="danger">critical</Badge>
                : it.priority === 'high' ? <Badge tone="warn">high</Badge> : null}
            </>
          }
          onClick={() => openHref(it.deepLink)}
        />
      ))}
      {shown.length === 0 && (
        <p className="px-2.5 py-2 text-xs text-slate-400">{loading ? 'Loading…' : emptyText}</p>
      )}
    </DashPanel>
  )
}
