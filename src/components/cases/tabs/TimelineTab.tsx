'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { Tables } from '@/lib/database.types'
import { list, rpc } from '@/lib/db'
import { caseLink } from '@/lib/caseLinks'
import { timeAgo } from '@/lib/format'
import { mediaTimelineEvents, type MediaEventInput } from '@/lib/caseMedia'
import { officerName } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { SIGNOFF_ACTION_VERB } from '@/lib/signoff'
import { ErrorNotice } from '@/components/ui/Notice'
import { TimelineBand, type BandEvent } from '../TimelineBand'
import type { CaseRow, EvidenceRow, HistoryRow, HoldRow, ReportRow, TaskRow } from './shared'

type RestrictedEventRow = Tables<'restricted_access_log'>

/** Restricted-access trail vocabulary (Phase 6). Case-scoped actions carry
 *  the CASE id in entity_id; view/download rows carry the MEDIA id — those
 *  label with the media title when the already-loaded media list resolves it
 *  (a title the viewer can't read stays "restricted item"). */
function restrictedEventLabel(x: RestrictedEventRow, titleOf: (id: string) => string | null): string {
  const item = () => titleOf(x.entity_id) ?? 'restricted item'
  switch (x.action) {
    case 'request': return '🔓 Restricted access requested'
    case 'grant': return 'Restricted access granted (24h)'
    case 'deny': return 'Restricted access denied'
    case 'revoke': return 'Restricted access revoked'
    case 'break_glass': return 'Restricted media break-glass (legacy)'
    case 'packet_export': return 'Restricted packet export approved'
    case 'view': return `Restricted view — ${item()}`
    case 'download': return `Restricted download — ${item()}`
    default: return `Restricted access — ${x.action}`
  }
}

export function TimelineTab({ c }: { c: CaseRow }) {
  const [rows, setRows] = useState<BandEvent[]>([])
  // A load failure surfaces with Retry (IntelTab's rule: a fetch error must
  // never read as an empty timeline). Cleared on the next good fetch.
  const [err, setErr] = useState<unknown>(null)
  const vE = useTableVersion('evidence')
  const vM = useTableVersion('media')
  const vR = useTableVersion('reports')
  const vT = useTableVersion('case_tasks')
  const vS = useTableVersion('case_signoff_history')
  const vH = useTableVersion('legal_holds')
  const vG = useTableVersion('restricted_access_grants')
  const refresh = useCallback(async () => {
    try {
      const [e, m, r, t, s, h, ra] = await Promise.all([
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
        // Restricted-access trail (Phase 6) — the curated case-member RPC
        // (the raw log stays command-only). Fail-open to empty.
        rpc('case_restricted_events', { p_case: c.id })
          .then((x) => (Array.isArray(x.data) ? x.data : []) as RestrictedEventRow[])
          .catch(() => [] as RestrictedEventRow[]),
      ])
      const mediaTitle = new Map(m.map((x) => [x.id, x.title]))
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
        ...ra.map((x) => ({
          at: x.created_at,
          label: restrictedEventLabel(x, (id) => mediaTitle.get(id) ?? null),
          sub: [officerName(x.actor_id) || undefined, x.reason || undefined].filter(Boolean).join(' · ') || undefined,
          type: 'restricted' as const,
          href: caseLink(c.id, 'media'),
        })),
      ] as BandEvent[]).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()))
      setErr(null)
    } catch (e) { setErr(e) }
  }, [c])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, vE, vM, vR, vT, vS, vH, vG])
  if (err) return <ErrorNotice message={err} onRetry={() => void refresh()} />
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
