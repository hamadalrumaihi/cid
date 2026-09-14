'use client'

/** "Needs attention" — the case's own waiting list, the viewer's moves first.
 *
 *  Deliberately NOT a second Action Center: every line is derived from rows of
 *  THIS case (lib/caseAttention), and the panel links into the case's own tabs
 *  rather than the division-wide queue. The Action Center stays the one
 *  personal queue across cases; this answers the same question inside one
 *  jacket, where the work actually is.
 *
 *  Urgency is never carried by colour alone: every line says whose move it is
 *  in words, and the severity chip is labelled. */
import Link from 'next/link'
import { caseLink } from '@/lib/caseLinks'
import { attentionMineCount, type AttentionItem } from '@/lib/caseAttention'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import type { Severity } from '@/lib/caseWorkflow'

const SEVERITY: Record<Severity, { tone: 'danger' | 'warn' | 'neutral'; label: string }> = {
  urgent: { tone: 'danger', label: 'Urgent' },
  warn: { tone: 'warn', label: 'Soon' },
  info: { tone: 'neutral', label: 'For info' },
}

export function NeedsAttentionPanel({ caseId, items }: { caseId: string; items: AttentionItem[] }) {
  // A case with nothing waiting says so once, quietly, rather than rendering
  // an empty frame that reads like a loading state.
  if (!items.length) {
    return (
      <Card pad="sm" className="text-sm text-slate-400">
        <span className="font-semibold text-slate-200">Nothing needs attention.</span>{' '}
        No overdue tasks, returned work or pending decisions on this case.
      </Card>
    )
  }

  const mine = attentionMineCount(items)
  return (
    <section aria-labelledby={`attention-${caseId}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 id={`attention-${caseId}`} className="text-sm font-semibold text-white">Needs attention</h3>
        <span className="text-xs text-slate-400">
          {mine > 0
            ? <><span className="font-semibold text-amber-300">{mine}</span> waiting on you · {items.length} in total</>
            : <>{items.length} open — none waiting on you</>}
        </span>
      </div>
      <Card pad="none">
        <ul className="divide-y divide-white/5">
          {items.map((item) => {
            const sev = SEVERITY[item.severity]
            const body = (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-slate-100">{item.label}</span>
                  {item.detail && <span className="block text-xs text-slate-400">{item.detail}</span>}
                </span>
                <span className="flex flex-shrink-0 items-center gap-1.5">
                  {item.mine && <Badge tone="accent">Your move</Badge>}
                  <Badge tone={sev.tone}>{sev.label}</Badge>
                </span>
              </>
            )
            return (
              <li key={item.key}>
                {item.tab ? (
                  <Link
                    href={caseLink(caseId, item.tab)}
                    className="flex min-h-[44px] items-center gap-3 px-3 py-2.5 transition hover:bg-white/5 sm:px-4"
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="flex min-h-[44px] items-center gap-3 px-3 py-2.5 sm:px-4">{body}</div>
                )}
              </li>
            )
          })}
        </ul>
      </Card>
    </section>
  )
}
