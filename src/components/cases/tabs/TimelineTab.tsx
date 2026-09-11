'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { Json } from '@/lib/database.types'
import { caseLink } from '@/lib/caseLinks'
import { custodyEventLabel } from '@/lib/evidence'
import { timeAgo } from '@/lib/format'
import {
  filterTimelineEvents, readTimelineFilters, TIMELINE_GROUPS, toggleTimelineGroup, writeTimelineFilters, type TimelineGroup,
} from '@/lib/timelineFilters'
import { fetchCaseTimeline, type CaseTimelineKind, type CaseTimelineRow } from '@/lib/services/cases'
import { useOperationsStore } from '@/lib/operations'
import { officerName } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { SIGNOFF_ACTION_VERB } from '@/lib/signoff'
import { ErrorNotice } from '@/components/ui/Notice'
import { TimelineBand, type BandEvent } from '../TimelineBand'
import type { CaseRow } from './shared'

/** The chronology now comes from ONE definer read — public.case_timeline, the
 *  shared read model both the portal and the FiveM lane render (it replaced
 *  this tab's former 11 parallel client reads; each arm mirrors the exact RLS
 *  the client reads had, see 20261002130000_shared_case_services.sql). This
 *  component only maps RPC event kinds onto the closed TimelineBand union.
 *
 *  Residual client-side derivations (deliberate, not reads):
 *  - "Case opened" / "Follow-up due" come from the cases row already in hand;
 *  - operation NAMES and the JTF resolution event resolve from the RLS-scoped
 *    operations store (the RPC returns operation_id only — resolving names
 *    server-side would leak operations the viewer cannot list).
 *
 *  Filter chips (Investigation / Evidence / Custody / Legal / Intelligence /
 *  Documents) narrow both the band and the list; the selection persists in
 *  localStorage (`lib/timelineFilters`). */

/** Tolerant meta readers — meta is jsonb and may omit keys. */
const metaOf = (m: Json): Record<string, unknown> =>
  m && typeof m === 'object' && !Array.isArray(m) ? (m as Record<string, unknown>) : {}
const mStr = (m: Record<string, unknown>, k: string): string | null =>
  typeof m[k] === 'string' && m[k] ? (m[k] as string) : null
const mNum = (m: Record<string, unknown>, k: string): number =>
  typeof m[k] === 'number' ? (m[k] as number) : 0
const mBool = (m: Record<string, unknown>, k: string): boolean => m[k] === true
const mList = (m: Record<string, unknown>, k: string): string[] =>
  Array.isArray(m[k]) ? (m[k] as unknown[]).filter((x): x is string => typeof x === 'string') : []

/** Restricted-access trail vocabulary (Phase 6). Case-scoped actions carry no
 *  media title; view/download rows label with the media title the SERVER
 *  resolved under the same visibility rules as the media list (a title the
 *  viewer can't read arrives null and stays "restricted item"). */
function restrictedEventLabel(action: string, mediaTitle: string | null): string {
  const item = mediaTitle ?? 'restricted item'
  switch (action) {
    case 'request': return 'Restricted access requested'
    case 'grant': return 'Restricted access granted (24h)'
    case 'deny': return 'Restricted access denied'
    case 'revoke': return 'Restricted access revoked'
    case 'break_glass': return 'Restricted media break-glass (legacy)'
    case 'packet_export': return 'Restricted packet export approved'
    case 'view': return `Restricted view — ${item}`
    case 'download': return `Restricted download — ${item}`
    default: return `Restricted access — ${action}`
  }
}

/** Slim operations-store projection this tab needs for op-link labeling. */
interface OpLite { id: string; name: string; status: string; resolved_at: string | null }

/** One RPC event → 0..2 band events (op_link can also yield the operation-
 *  resolution event, derived from the ops store exactly as before). */
function mapRow(row: CaseTimelineRow, caseId: string, operations: readonly OpLite[]): BandEvent[] {
  const m = metaOf(row.meta)
  const actorName = officerName(row.actor) || undefined
  switch (row.kind as CaseTimelineKind) {
    case 'evidence':
      return [{ at: row.at, label: `Evidence ${row.title || ''}`, sub: mStr(m, 'description') ?? undefined, type: 'evidence', href: row.ref_id ? caseLink(caseId, 'media', { evidence: row.ref_id }) : caseLink(caseId, 'media') }]
    case 'media_added': {
      const count = mNum(m, 'count')
      if (count > 1) {
        return [{ at: row.at, label: `${actorName || 'An officer'} added ${count} case photos`, items: mList(m, 'items'), type: 'media', href: caseLink(caseId, 'media') }]
      }
      return [{ at: row.at, label: `Photo added: ${row.title ?? ''}`, sub: actorName, type: 'media', href: caseLink(caseId, 'media') }]
    }
    case 'media_archived':
      return [{ at: row.at, label: `Photo archived: ${row.title ?? ''}`, type: 'media', href: caseLink(caseId, 'media') }]
    case 'media_featured':
      return [{ at: row.at, label: `Photo featured: ${row.title ?? ''}`, type: 'media', href: caseLink(caseId, 'media') }]
    case 'report':
      return [{ at: row.at, label: `${row.title} report`, sub: mBool(m, 'finalized') ? 'Finalized' : 'Draft', type: 'report', href: row.ref_id ? caseLink(caseId, 'reports', { report: row.ref_id }) : caseLink(caseId, 'reports') }]
    case 'task':
      return [{ at: row.at, label: `Task: ${row.title ?? ''}`, sub: mBool(m, 'done') ? 'Done' : 'Open', type: 'task', href: row.ref_id ? caseLink(caseId, 'tasks', { task: row.ref_id }) : caseLink(caseId, 'tasks') }]
    case 'signoff':
      return [{ at: row.at, label: SIGNOFF_ACTION_VERB[row.title ?? ''] || row.title || 'Sign-off', sub: mStr(m, 'actor_name') || actorName, type: 'signoff' }]
    case 'hold_placed':
      return [{ at: row.at, label: 'Legal hold placed', sub: [mStr(m, 'reason'), officerName(row.actor) || 'command'].filter(Boolean).join(' · '), type: 'hold' }]
    case 'hold_lifted':
      return [{ at: row.at, label: 'Legal hold lifted', sub: [mStr(m, 'lift_reason'), officerName(row.actor) || 'command'].filter(Boolean).join(' · '), type: 'hold' }]
    case 'restricted':
      return [{
        at: row.at,
        label: restrictedEventLabel(row.title ?? '', mStr(m, 'media_title')),
        sub: [actorName, mStr(m, 'reason') ?? undefined].filter(Boolean).join(' · ') || undefined,
        type: 'restricted',
        href: caseLink(caseId, 'media'),
      }]
    case 'op_link': {
      const op = operations.find((o) => o.id === row.ref_id)
      const name = op?.name ?? 'operation'
      const joint = mBool(m, 'was_jtf')
      const events: BandEvent[] = [{
        at: row.at,
        label: joint ? `Case joined Joint Operation “${name}”` : `Case linked to Operation “${name}”`,
        sub: actorName,
        type: 'task',
      }]
      // Operation resolution while this case was (still) linked — derived
      // from the ops store, so an op the viewer can't see adds nothing.
      if (joint && !mStr(m, 'removed_at') && op?.resolved_at) {
        events.push({
          at: op.resolved_at,
          label: `Joint Operation “${name}” was ${op.status === 'closed' ? 'closed' : 'resolved'}`,
          type: 'task',
        })
      }
      return events
    }
    case 'op_unlink': {
      const op = operations.find((o) => o.id === row.ref_id)
      const name = op?.name ?? 'operation'
      const joint = mBool(m, 'was_jtf')
      return [{
        at: row.at,
        label: joint ? `Case removed from Joint Operation “${name}”` : `Case unlinked from Operation “${name}”`,
        sub: [actorName, mStr(m, 'removal_reason') ?? undefined].filter(Boolean).join(' · ') || undefined,
        type: 'task',
      }]
    }
    // Surveillance lifecycle — short labels on the 'task' lane, filtered
    // under Intelligence (group overrides the lane's default).
    case 'surv_requested':
      return [{ at: row.at, label: `Surveillance requested — ${row.title ?? ''}`, type: 'task', group: 'intelligence', href: caseLink(caseId, 'surveillance') }]
    case 'surv_authorized':
      return [{ at: row.at, label: 'Surveillance authorized', sub: row.title ?? undefined, type: 'task', group: 'intelligence', href: caseLink(caseId, 'surveillance') }]
    case 'surv_ended': {
      const status = mStr(m, 'status') ?? 'ended'
      return [{ at: row.at, label: `Surveillance ${status === 'denied' ? 'denied' : status}`, sub: row.title ?? undefined, type: 'task', group: 'intelligence', href: caseLink(caseId, 'surveillance') }]
    }
    case 'surv_observation':
      return [{ at: row.at, label: 'Observation received', sub: mStr(m, 'activity') ?? undefined, type: 'task', group: 'intelligence', href: caseLink(caseId, 'surveillance') }]
    case 'surv_verified':
      return [{ at: row.at, label: 'Observation verified', sub: mStr(m, 'activity') ?? undefined, type: 'task', group: 'intelligence', href: caseLink(caseId, 'surveillance') }]
    case 'surv_alert':
      return [{ at: row.at, label: `Surveillance alert — ${row.title ?? ''}`, type: 'task', group: 'intelligence', href: caseLink(caseId, 'surveillance') }]
    // Platform upgrade lanes (20261105120000). `custody` carries the
    // evidence_custody_events event_type in meta; title is the evidence
    // number or media title the server resolved under the viewer's rights.
    case 'custody': {
      const eventType = mStr(m, 'event_type')
      const item = row.title ?? mStr(m, 'evidence_number') ?? 'evidence'
      const custodian = officerName(mStr(m, 'new_custodian')) ?? undefined
      return [{
        at: row.at,
        label: `${custodyEventLabel(eventType)} — ${item}`,
        sub: [actorName, eventType === 'TRANSFERRED' && custodian ? `to ${custodian}` : null, mStr(m, 'reason')].filter(Boolean).join(' · ') || undefined,
        type: 'custody',
        href: row.ref_id ? caseLink(caseId, 'media', { media: row.ref_id }) : caseLink(caseId, 'media'),
      }]
    }
    case 'packet':
      return [{ at: row.at, label: `Case packet ready — ${row.title ?? mStr(m, 'packet_type') ?? 'packet'}`, sub: actorName, type: 'packet', href: row.ref_id ? caseLink(caseId, 'documents', { packet: row.ref_id }) : caseLink(caseId, 'documents') }]
    case 'source':
      return [{ at: row.at, label: `External source linked — ${row.title ?? mStr(m, 'source_number') ?? mStr(m, 'domain') ?? 'source'}`, sub: [actorName, mStr(m, 'domain')].filter(Boolean).join(' · ') || undefined, type: 'source', href: row.ref_id ? `/intelligence?source=${encodeURIComponent(row.ref_id)}` : '/intelligence' }]
    case 'document':
      return [{ at: row.at, label: `Document processed — ${row.title ?? 'document'}`, sub: [mStr(m, 'service'), mNum(m, 'page_count') ? `${mNum(m, 'page_count')} pages` : null].filter(Boolean).join(' · ') || undefined, type: 'document', href: row.ref_id ? caseLink(caseId, 'documents', { media: row.ref_id }) : caseLink(caseId, 'documents') }]
    default:
      // Forward compatibility: an event kind this build doesn't know is
      // dropped rather than crashing the tab.
      return []
  }
}

export function TimelineTab({ c }: { c: CaseRow }) {
  const [rows, setRows] = useState<BandEvent[]>([])
  // Filter chips — persisted per browser; the server snapshot renders
  // everything on, the client corrects after mount.
  const [enabled, setEnabled] = useState<Set<TimelineGroup>>(() => new Set(TIMELINE_GROUPS.map((g) => g.id)))
  useEffect(() => {
    const stored = readTimelineFilters(window.localStorage)
    // Only adopt a stored selection that differs (avoids a no-op re-render).
    if (stored.size !== TIMELINE_GROUPS.length) queueMicrotask(() => setEnabled(stored))
  }, [])
  const toggle = (g: TimelineGroup) => {
    const next = toggleTimelineGroup(enabled, g)
    setEnabled(next)
    writeTimelineFilters(window.localStorage, next)
  }
  // A load failure surfaces with Retry (IntelTab's rule: a fetch error must
  // never read as an empty timeline). Cleared on the next good fetch.
  const [err, setErr] = useState<unknown>(null)
  // Same realtime triggers as before — every table the server-side read model
  // draws from refreshes the single RPC call.
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
  const vC = useTableVersion('evidence_custody_events')
  const vP = useTableVersion('case_packets')
  const vX = useTableVersion('external_source_links')
  const vD = useTableVersion('document_extractions')
  const operations = useOperationsStore((st) => st.operations)
  const refresh = useCallback(async () => {
    try {
      const events = await fetchCaseTimeline(c.id)
      setRows(([
        { at: c.created_at, label: 'Case opened', sub: c.case_number, type: 'opened' },
        ...(c.follow_up_at ? [{ at: c.follow_up_at, label: 'Follow-up due', type: 'followup' as const }] : []),
        ...events.flatMap((row) => mapRow(row, c.id, operations)),
      ] as BandEvent[]).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()))
      setErr(null)
    } catch (e) { setErr(e) }
  }, [c, operations])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, vE, vM, vR, vT, vS, vH, vG, vOL, vSvT, vSvO, vSvA, vC, vP, vX, vD])
  if (err) return <ErrorNotice message={err} onRetry={() => void refresh()} />
  const visible = filterTimelineEvents(rows, enabled)
  return (
    <div>
      <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Filter timeline by area">
        {TIMELINE_GROUPS.map((g) => {
          const on = enabled.has(g.id)
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => toggle(g.id)}
              aria-pressed={on}
              className={`min-h-9 flex-shrink-0 touch-manipulation whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-semibold transition lg:min-h-0 ${on ? 'border-badge-500 bg-blue-500/10 text-white' : 'border-white/10 bg-white/5 text-slate-400 hover:bg-white/10'}`}
            >
              {g.label}
            </button>
          )
        })}
      </div>
      <TimelineBand events={visible} />
      {visible.length === 0 && rows.length > 0 && (
        <p className="rounded-lg border border-white/10 bg-ink-950/50 p-6 text-center text-sm text-slate-400">
          No events in the selected areas — turn a filter back on to see them.
        </p>
      )}
      <div className="space-y-2">
        {visible.map((r, i) => {
          const body = (
            <>
              <p className="font-semibold text-white">{r.label}</p>
              <p className="text-sm text-slate-400">{timeAgo(r.at)}{r.sub ? ` - ${r.sub}` : ''}</p>
            </>
          )
          return (
            <div key={`${r.at}-${i}`} className="rounded-lg border border-white/10 bg-ink-950/50 p-3">
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
