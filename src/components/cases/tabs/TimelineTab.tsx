'use client'

import { useCallback, useEffect, useState } from 'react'
import { list } from '@/lib/db'
import { timeAgo } from '@/lib/format'
import { officerName } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { SIGNOFF_ACTION_VERB } from '@/lib/signoff'
import { TimelineBand, type BandEvent } from '../TimelineBand'
import type { CaseRow, EvidenceRow, HistoryRow, ReportRow, TaskRow } from './shared'

export function TimelineTab({ c }: { c: CaseRow }) {
  const [rows, setRows] = useState<BandEvent[]>([])
  const vE = useTableVersion('evidence')
  const vR = useTableVersion('reports')
  const vT = useTableVersion('case_tasks')
  const vS = useTableVersion('case_signoff_history')
  const refresh = useCallback(async () => {
    try {
      const [e, r, t, s] = await Promise.all([
        list('evidence', { eq: { case_id: c.id } }) as Promise<EvidenceRow[]>,
        list('reports', { eq: { case_id: c.id } }) as Promise<ReportRow[]>,
        list('case_tasks', { eq: { case_id: c.id } }) as Promise<TaskRow[]>,
        list('case_signoff_history', { eq: { case_id: c.id } }) as Promise<HistoryRow[]>,
      ])
      setRows(([
        { at: c.created_at, label: 'Case opened', sub: c.case_number, type: 'opened' },
        ...(c.follow_up_at ? [{ at: c.follow_up_at, label: 'Follow-up due', type: 'followup' as const }] : []),
        ...e.map((x) => ({ at: x.collected_at || x.created_at, label: `Evidence ${x.item_code || ''}`, sub: x.description || undefined, type: 'evidence' as const })),
        ...r.map((x) => ({ at: x.created_at, label: `${x.template} report`, sub: x.finalized ? 'Finalized' : 'Draft', type: 'report' as const })),
        ...t.map((x) => ({ at: x.created_at, label: `Task: ${x.title}`, sub: x.done ? 'Done' : 'Open', type: 'task' as const })),
        ...s.map((x) => ({ at: x.created_at, label: SIGNOFF_ACTION_VERB[x.action] || x.action, sub: x.actor_name || officerName(x.actor_id) || undefined, type: 'signoff' as const })),
      ] as BandEvent[]).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()))
    } catch { /* stale */ }
  }, [c])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, vE, vR, vT, vS])
  return (
    <div>
      <TimelineBand events={rows} />
      <div className="space-y-2">{rows.map((r, i) => <div key={`${r.at}-${i}`} className="rounded-xl border border-white/10 bg-ink-950/50 p-3"><p className="font-semibold text-white">{r.label}</p><p className="text-sm text-slate-500">{timeAgo(r.at)}{r.sub ? ` - ${r.sub}` : ''}</p></div>)}</div>
    </div>
  )
}
