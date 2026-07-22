'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { list } from '@/lib/db'
import { caseLink } from '@/lib/caseLinks'
import { timeAgo } from '@/lib/format'
import { mediaTimelineEvents, type MediaEventInput } from '@/lib/caseMedia'
import { officerName } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { SIGNOFF_ACTION_VERB } from '@/lib/signoff'
import { TimelineBand, type BandEvent } from '../TimelineBand'
import type { CaseRow, EvidenceRow, HistoryRow, HoldRow, ReportRow, TaskRow } from './shared'

export function TimelineTab({ c }: { c: CaseRow }) {
  const [rows, setRows] = useState<BandEvent[]>([])
  const vE = useTableVersion('evidence')
  const vM = useTableVersion('media')
  const vR = useTableVersion('reports')
  const vT = useTableVersion('case_tasks')
  const vS = useTableVersion('case_signoff_history')
  const vH = useTableVersion('legal_holds')
  const refresh = useCallback(async () => {
    try {
      const [e, m, r, t, s, h] = await Promise.all([
        list('evidence', { eq: { case_id: c.id } }) as Promise<EvidenceRow[]>,
        // Media events are derived from row columns only (added/archived/
        // featured) — there is no media event table.
        list('media', { select: 'id,title,created_at,updated_at,archived_at,featured,uploaded_by', eq: { case_id: c.id } })
          .then((x) => x as unknown as MediaEventInput[]).catch(() => [] as MediaEventInput[]),
        list('reports', { eq: { case_id: c.id } }) as Promise<ReportRow[]>,
        list('case_tasks', { eq: { case_id: c.id } }) as Promise<TaskRow[]>,
        list('case_signoff_history', { eq: { case_id: c.id } }) as Promise<HistoryRow[]>,
        // Legal holds — placed/lifted both surface as their own band events.
        (list('legal_holds', { eq: { case_id: c.id } }) as Promise<HoldRow[]>).catch(() => [] as HoldRow[]),
      ])
      setRows(([
        { at: c.created_at, label: 'Case opened', sub: c.case_number, type: 'opened' },
        ...(c.follow_up_at ? [{ at: c.follow_up_at, label: 'Follow-up due', type: 'followup' as const }] : []),
        ...e.map((x) => ({ at: x.collected_at || x.created_at, label: `Evidence ${x.item_code || ''}`, sub: x.description || undefined, type: 'evidence' as const, href: caseLink(c.id, 'media', { evidence: x.id }) })),
        ...mediaTimelineEvents(m, officerName).map((ev) => ({ at: ev.at, label: ev.label, sub: ev.sub, items: ev.items, type: 'media' as const, href: caseLink(c.id, 'media') })),
        ...r.map((x) => ({ at: x.created_at, label: `${x.template} report`, sub: x.finalized ? 'Finalized' : 'Draft', type: 'report' as const, href: caseLink(c.id, 'reports', { report: x.id }) })),
        ...t.map((x) => ({ at: x.created_at, label: `Task: ${x.title}`, sub: x.done ? 'Done' : 'Open', type: 'task' as const, href: caseLink(c.id, 'tasks', { task: x.id }) })),
        ...s.map((x) => ({ at: x.created_at, label: SIGNOFF_ACTION_VERB[x.action] || x.action, sub: x.actor_name || officerName(x.actor_id) || undefined, type: 'signoff' as const })),
        ...h.flatMap((x) => [
          { at: x.placed_at, label: 'Legal hold placed', sub: [x.reason, officerName(x.placed_by) || 'command'].filter(Boolean).join(' · '), type: 'hold' as const },
          ...(x.lifted_at ? [{ at: x.lifted_at, label: 'Legal hold lifted', sub: [x.lift_reason || undefined, officerName(x.lifted_by) || 'command'].filter(Boolean).join(' · '), type: 'hold' as const }] : []),
        ]),
      ] as BandEvent[]).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()))
    } catch { /* stale */ }
  }, [c])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, vE, vM, vR, vT, vS, vH])
  return (
    <div>
      <TimelineBand events={rows} />
      <div className="space-y-2">
        {rows.map((r, i) => {
          const body = (
            <>
              <p className="font-semibold text-white">{r.label}</p>
              <p className="text-sm text-slate-400">{timeAgo(r.at)}{r.sub ? ` - ${r.sub}` : ''}</p>
            </>
          )
          return (
            <div key={`${r.at}-${i}`} className="rounded-xl border border-white/10 bg-ink-950/50 p-3">
              {r.href ? (
                <Link href={r.href} className="block rounded-lg transition hover:bg-white/[0.03]">{body}</Link>
              ) : body}
              {r.items && r.items.length > 0 && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs font-semibold text-slate-400 hover:text-slate-300">
                    Show {r.items.length} photos
                  </summary>
                  <ul className="mt-1 list-inside list-disc text-xs text-slate-400">
                    {r.items.map((title, j) => <li key={`${title}-${j}`}>{title}</li>)}
                  </ul>
                </details>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
