'use client'

/** Compact, table-like queue rows for the DOJ workspace lists. Deliberately
 *  dense and undecorated (no tiles): mono request number, type, case number,
 *  responsible-bureau badge, age in the queue, and at most ONE action button.
 *  Sealed rows follow the existing list convention — number + type only,
 *  never a title or target (RLS already trimmed who sees the row at all). */
import { useState } from 'react'
import { timeAgo } from '@/lib/format'
import type { LegalRequest } from '@/lib/justice'
import { humanize } from '@/lib/legalWorkflow'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ClassificationBadge } from '@/components/justice/legalShared'

export interface DojRowAction {
  label: string
  onRun: (r: LegalRequest) => Promise<void>
  variant?: 'primary' | 'secondary'
}

export function DojQueueList({ rows, onOpen, ageOf, ageLabel = 'waiting', action, empty }: {
  rows: LegalRequest[]
  onOpen: (id: string) => void
  /** Timestamp the age column counts from (falls back to updated_at). */
  ageOf: (r: LegalRequest) => string | null
  ageLabel?: string
  /** At most one action per row; null hides the button for that row. */
  action?: (r: LegalRequest) => DojRowAction | null
  empty: string
}) {
  const [busyId, setBusyId] = useState<string | null>(null)

  if (rows.length === 0) {
    return <p className="rounded-lg border border-dashed border-white/10 px-3 py-2.5 text-xs text-slate-400">{empty}</p>
  }

  const run = async (a: DojRowAction, r: LegalRequest) => {
    setBusyId(r.id)
    try { await a.onRun(r) } finally { setBusyId(null) }
  }

  return (
    <ul className="divide-y divide-white/5 rounded-2xl border border-white/5 bg-ink-900/60">
      {rows.map((r) => {
        const sealed = r.classification === 'sealed'
        const a = action?.(r) ?? null
        const at = ageOf(r) ?? r.updated_at
        return (
          <li key={r.id} className="flex min-h-[48px] flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 sm:flex-nowrap">
            <button
              type="button"
              onClick={() => onOpen(r.id)}
              aria-label={`Open request ${r.request_number}`}
              className="-mx-1.5 -my-1 flex min-h-[40px] min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-1.5 py-1 text-left transition hover:bg-white/5"
            >
              <span className="font-mono text-xs tabular-nums text-blue-300">{r.request_number}</span>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {humanize(r.subtype ?? r.request_type)}
              </span>
              {!sealed && r.case_number_snapshot && (
                <span className="font-mono text-xs tabular-nums text-slate-300">{r.case_number_snapshot}</span>
              )}
              {r.responsible_bureau && <Badge tone="neutral">{r.responsible_bureau}</Badge>}
              {r.classification !== 'standard' && <ClassificationBadge value={r.classification} />}
            </button>
            <span className="flex-shrink-0 text-xs text-slate-400" title={at ?? undefined}>
              {at ? `${ageLabel} ${timeAgo(at)}` : '—'}
            </span>
            <div className="flex flex-shrink-0 items-center gap-2">
              {a && (
                <Button
                  size="sm"
                  variant={a.variant ?? 'primary'}
                  loading={busyId === r.id}
                  disabled={busyId !== null}
                  onClick={() => void run(a, r)}
                >
                  {a.label}
                </Button>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
