'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { Tables } from '@/lib/database.types'
import { list, rpc } from '@/lib/db'
import { caseLink } from '@/lib/caseLinks'
import { timeAgo } from '@/lib/format'
import { mediaTimelineEvents, type MediaEventInput } from '@/lib/caseMedia'
import { useOperationsStore } from '@/lib/operations'
import type { OpCaseLinkRow } from '@/lib/opsJoint'
import { officerName } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { SIGNOFF_ACTION_VERB } from '@/lib/signoff'
import { ErrorNotice } from '@/components/ui/Notice'
import { TimelineBand, type BandEvent } from '../TimelineBand'
import type { CaseRow, EvidenceRow, HistoryRow, HoldRow, ReportRow, TaskRow } from './shared'

type RestrictedEventRow = Tables<'restricted_access_log'>

/** Slim surveillance projections — fail-open sources (the domain may be
 *  absent/sealed in an environment; the timeline never sinks on it). */
type SurvTargetEventRow = Pick<Tables<'surveillance_targets'>,
  'id' | 'label' | 'status' | 'created_at' | 'approved_at' | 'ended_at'>
type SurvObsEventRow = Pick<Tables<'surveillance_observations'>,
  'id' | 'activity' | 'created_at' | 'reviewed_at' | 'verification_status'>
type SurvAlertEventRow = Pick<Tables<'surveillance_alerts'>, 'id' | 'title' | 'created_at'>

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
  const vOL = useTableVersion('operation_case_links')
  const vSvT = useTableVersion('surveillance_targets')
  const vSvO = useTableVersion('surveillance_observations')
  const vSvA = useTableVersion('surveillance_alerts')
  const operations = useOperationsStore((st) => st.operations)
  const refresh = useCallback(async () => {
    try {
      const [e, m, r, t, s, h, ra, ol, st, so, sa] = await Promise.all([
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
        // Operation participation history (permanent rows — joined/removed/
        // resolution events survive operation closure). Fail-open to empty.
        (list('operation_case_links', { eq: { case_id: c.id } }) as Promise<OpCaseLinkRow[]>)
          .catch(() => [] as OpCaseLinkRow[]),
        // Surveillance history-worthy events (requested/authorized/concluded),
        // observation receipt/verification, and rule-generated alerts — all
        // fail-open (the domain may not exist in this environment).
        list('surveillance_targets', { select: 'id,label,status,created_at,approved_at,ended_at', eq: { case_id: c.id } })
          .then((x) => x as unknown as SurvTargetEventRow[]).catch(() => [] as SurvTargetEventRow[]),
        list('surveillance_observations', { select: 'id,activity,created_at,reviewed_at,verification_status', eq: { case_id: c.id } })
          .then((x) => x as unknown as SurvObsEventRow[]).catch(() => [] as SurvObsEventRow[]),
        list('surveillance_alerts', { select: 'id,title,created_at', eq: { case_id: c.id } })
          .then((x) => x as unknown as SurvAlertEventRow[]).catch(() => [] as SurvAlertEventRow[]),
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
        ...ol.flatMap((x) => {
          const op = operations.find((o) => o.id === x.operation_id)
          const name = op?.name ?? 'operation'
          const joint = x.was_jtf
          const events = [{
            at: x.added_at,
            label: joint ? `Case joined Joint Operation “${name}”` : `Case linked to Operation “${name}”`,
            sub: officerName(x.added_by) || undefined,
            type: 'task' as const,
          }, ...(x.removed_at ? [{
            at: x.removed_at,
            label: joint ? `Case removed from Joint Operation “${name}”` : `Case unlinked from Operation “${name}”`,
            sub: [officerName(x.removed_by) || undefined, x.removal_reason || undefined].filter(Boolean).join(' · ') || undefined,
            type: 'task' as const,
          }] : [])]
          // Operation resolution while this case was (still) linked.
          if (joint && !x.removed_at && op?.resolved_at) {
            events.push({
              at: op.resolved_at,
              label: `Joint Operation “${name}” was ${op.status === 'closed' ? 'closed' : 'resolved'}`,
              sub: undefined as unknown as string,
              type: 'task' as const,
            })
          }
          return events
        }),
        // Surveillance lifecycle — short labels, 'task' lane (BandEvent's
        // union is closed; surveillance rides the generic activity lane).
        ...st.flatMap((x) => [
          { at: x.created_at, label: `Surveillance requested — ${x.label}`, type: 'task' as const, href: caseLink(c.id, 'surveillance') },
          ...(x.approved_at ? [{ at: x.approved_at, label: 'Surveillance authorized', sub: x.label, type: 'task' as const, href: caseLink(c.id, 'surveillance') }] : []),
          ...(x.ended_at ? [{ at: x.ended_at, label: `Surveillance ${x.status === 'denied' ? 'denied' : x.status}`, sub: x.label, type: 'task' as const, href: caseLink(c.id, 'surveillance') }] : []),
        ]),
        ...so.flatMap((x) => [
          { at: x.created_at, label: 'Observation received', sub: x.activity || undefined, type: 'task' as const, href: caseLink(c.id, 'surveillance') },
          ...(x.reviewed_at && x.verification_status === 'verified'
            ? [{ at: x.reviewed_at, label: 'Observation verified', sub: x.activity || undefined, type: 'task' as const, href: caseLink(c.id, 'surveillance') }]
            : []),
        ]),
        ...sa.map((x) => ({ at: x.created_at, label: `Surveillance alert — ${x.title}`, type: 'task' as const, href: caseLink(c.id, 'surveillance') })),
      ] as BandEvent[]).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()))
      setErr(null)
    } catch (e) { setErr(e) }
  }, [c, operations])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, vE, vM, vR, vT, vS, vH, vG, vOL, vSvT, vSvO, vSvA])
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
