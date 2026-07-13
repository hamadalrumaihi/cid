'use client'

/** Shared deadline chip (v1.14) — one look for every due/expiry warning in
 *  the portal (legal deadlines, task due dates, joint-access expiry,
 *  follow-ups). Promoted from the DOJ build per the adoption register. */
import { deadlineInfo, type DeadlineKind } from '@/lib/deadlines'

export function DeadlineChip({ at, kind = 'due', now, className = '' }: {
  at: string | null | undefined
  kind?: DeadlineKind
  now?: number
  className?: string
}) {
  const info = deadlineInfo(at, kind, { now })
  if (!info) return null
  const tone = info.overdue
    ? 'border-rose-500/25 bg-rose-500/10 text-rose-300'
    : info.urgent
      ? 'border-amber-500/25 bg-amber-500/10 text-amber-300'
      : 'border-white/10 bg-white/5 text-slate-300'
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold ${tone} ${className}`}>
      {info.text}
    </span>
  )
}
