'use client'

/** Shared workflow timeline (v1.14) — the DOJ legal-history renderer promoted
 *  to a portal-wide component (adoption register: "workflow-history
 *  timelines"). Domain tables stay separate; each caller maps its rows into
 *  TimelineEntry with its own labels. The database remains the authority —
 *  this is presentation only. */

export interface TimelineEntry {
  id: string
  /** Human action title, already labeled by the domain ("Submitted to DOJ"). */
  title: string
  actor?: string | null
  at: string
  /** Optional status transition, already labeled. */
  from?: string | null
  to?: string | null
  note?: string | null
}

export function WorkflowTimeline({ entries, empty = 'No recorded actions.', dense = false }: {
  entries: TimelineEntry[]
  empty?: string
  dense?: boolean
}) {
  if (entries.length === 0) {
    return <p className="text-sm text-slate-500">{empty}</p>
  }
  return (
    <ol className={dense ? 'space-y-1.5' : 'space-y-2'}>
      {entries.map((e) => (
        <li key={e.id} className="flex flex-wrap items-baseline gap-2 border-l-2 border-badge-500/30 pl-3 text-sm">
          <span className="font-semibold text-white">{e.title}</span>
          {e.actor && <span className="text-xs text-slate-400">{e.actor}</span>}
          {e.to && (
            <span className="text-xs text-slate-500">
              {e.from ? `${e.from} → ${e.to}` : `→ ${e.to}`}
            </span>
          )}
          <span className="text-xs text-slate-500">{new Date(e.at).toLocaleString()}</span>
          {e.note && <span className="w-full text-xs text-slate-300">“{e.note}”</span>}
        </li>
      ))}
    </ol>
  )
}
