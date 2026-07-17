'use client'

/** Shared legal-review building blocks used by BOTH portals (CID LegalView
 *  and the Justice portal): classification badges, status chips, deadline
 *  warnings, request lists, and the name-resolution hooks that work for
 *  justice-only users (who cannot read the CID roster — names come from the
 *  justice_directory / legal_request_people definer RPCs).
 *
 *  Shared-platform note: ClassificationBadge, DeadlineChip and the workflow
 *  timeline in LegalRequestDetail are deliberately generic — candidates for
 *  reuse by reports, membership requests and case sign-off (see the adoption
 *  register in docs/DOJ-INTEGRATION.md). */
import { useCallback, useEffect, useState } from 'react'
import { list, rpc } from '@/lib/db'
import { useTableVersion } from '@/lib/realtime'
import { useAuth } from '@/lib/auth'
import type { LegalViewer } from '@/lib/legalWorkflow'
import {
  CLASSIFICATION_STYLE, deadlineInfo, fulfilmentLabel,
  reviewStatusLabel, type Classification, type LegalRequest,
} from '@/lib/justice'
import { LegalRequestCard } from './LegalRequestCard'

export function ClassificationBadge({ value }: { value: string }) {
  const cls = CLASSIFICATION_STYLE[(value as Classification)] ?? CLASSIFICATION_STYLE.standard
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${cls}`}>
      {value === 'sealed' ? '🔒 ' : ''}{value}
    </span>
  )
}

export function StatusChip({ label, tone = 'slate' }: { label: string; tone?: 'slate' | 'amber' | 'emerald' | 'rose' | 'blue' }) {
  const tones: Record<string, string> = {
    slate: 'border-white/10 bg-white/5 text-slate-300',
    amber: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
    emerald: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
    rose: 'border-rose-500/25 bg-rose-500/10 text-rose-300',
    blue: 'border-badge-500/25 bg-badge-500/10 text-blue-300',
  }
  return <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold ${tones[tone]}`}>{label}</span>
}

export function reviewTone(status: string): 'slate' | 'amber' | 'emerald' | 'rose' | 'blue' {
  if (status === 'approved') return 'emerald'
  if (status === 'denied' || status.startsWith('returned')) return 'rose'
  if (status.endsWith('_review') || status.startsWith('submitted')) return 'amber'
  if (status === 'withdrawn') return 'slate'
  return 'blue'
}

export function DeadlineChip({ request }: { request: Pick<LegalRequest, 'expires_at' | 'response_deadline' | 'fulfilment_status'> }) {
  // Only live requests warn — closed/returned records keep a quiet history.
  if (['closed', 'returned', 'return_recorded', 'revoked'].includes(request.fulfilment_status)) return null
  const exp = deadlineInfo(request.expires_at, 'expires')
  const dl = deadlineInfo(request.response_deadline, 'deadline')
  const info = exp?.urgent ? exp : dl?.urgent ? dl : exp ?? dl
  if (!info) return null
  return <StatusChip label={info.text} tone={info.urgent ? 'rose' : 'slate'} />
}

/** id → display name for one request (definer RPC; request-scoped). */
export function useLegalPeople(requestId: string | null): Record<string, string> {
  const [people, setPeople] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!requestId) return
    let cancelled = false
    void rpc('legal_request_people', { p_request: requestId }).then((r) => {
      if (cancelled || r.error || !r.data) return
      setPeople(Object.fromEntries(r.data.map((p) => [p.id, p.display_name])))
    })
    return () => { cancelled = true }
  }, [requestId])
  return people
}

export interface JusticeDirEntry {
  user_id: string; display_name: string; agency: string
  justice_role: string; active: boolean; justice_identifier: string | null
}
/** The justice roster (definer RPC — visible to justice + CID + Owner). */
export function useJusticeDirectory(): { entries: JusticeDirEntry[]; reload: () => void } {
  const [entries, setEntries] = useState<JusticeDirEntry[]>([])
  const v = useTableVersion('justice_memberships')
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let cancelled = false
    void rpc('justice_directory', {} as never).then((r) => {
      if (!cancelled && !r.error && r.data) setEntries(r.data)
    })
    return () => { cancelled = true }
  }, [v, tick])
  return { entries, reload: useCallback(() => setTick((t) => t + 1), []) }
}

/** Narrow projection for the queue/card lists — only the columns the cards and
 *  the workflow model read. Trims the wire payload versus SELECT * (the wide
 *  row carries body markdown, exhibit blobs, audit fields); RLS still scopes
 *  which rows come back, unchanged. */
const LEGAL_LIST_COLS =
  'id,request_number,request_type,subtype,title,review_status,document_status,' +
  'fulfilment_status,service_status,compliance_status,approval_route,classification,' +
  'responsible_bureau,assigned_ada_id,assigned_judge_id,person_name_snapshot,' +
  'recipient_name,recipient_type,case_number_snapshot,expires_at,response_deadline,' +
  'submitted_to_doj_at,created_by,priority,created_at,updated_at,current_version_id'

/** RLS-scoped legal request loader — every queue filters CLIENT-side over
 *  rows the server already authorized; the queue predicate is presentation. */
export function useLegalRequests(): { requests: LegalRequest[]; loading: boolean; reload: () => void } {
  const [requests, setRequests] = useState<LegalRequest[]>([])
  const [loading, setLoading] = useState(true)
  const v = useTableVersion('legal_requests')
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const rows = await list('legal_requests', { select: LEGAL_LIST_COLS, order: 'created_at', ascending: false })
        if (!cancelled) setRequests(rows)
      } catch { /* transient */ }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [v, tick])
  return { requests, loading, reload: useCallback(() => setTick((t) => t + 1), []) }
}

/** Map the app's auth context → the workflow model's viewer. The model NEVER
 *  decides access (RLS + definer RPCs do); this only shapes what an authorised
 *  viewer is shown. */
export function buildLegalViewer(auth: ReturnType<typeof useAuth>): LegalViewer {
  const p = auth.profile
  const jr = auth.justiceRole
  const justiceRole =
    jr === 'assistant_district_attorney' || jr === 'district_attorney' ||
    jr === 'attorney_general' || jr === 'judge' ? jr : null
  return {
    myId: p?.id ?? null,
    cidActive: p?.active ?? false,
    cidRole: p?.role ?? null,
    justiceRole,
    isOwner: auth.isOwner,
    // TODO wire prosecutor bureaus (the portal does not surface them here yet).
    prosecutorBureaus: [],
  }
}

export function LegalRequestRow({ r, onOpen, people }: {
  r: LegalRequest
  onOpen: (id: string) => void
  people?: Record<string, string>
}) {
  return (
    <button
      onClick={() => onOpen(r.id)}
      className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2.5 text-left transition hover:border-badge-500/40 hover:bg-white/5"
    >
      <span className="font-mono text-xs text-blue-300">{r.request_number}</span>
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{r.request_type}</span>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{r.title}</span>
      <ClassificationBadge value={r.classification} />
      <StatusChip label={reviewStatusLabel(r.review_status)} tone={reviewTone(r.review_status)} />
      {r.review_status === 'approved' && r.fulfilment_status !== 'unissued' && (
        <StatusChip label={fulfilmentLabel(r.fulfilment_status)} tone="blue" />
      )}
      <DeadlineChip request={r} />
      <span className="text-xs text-slate-500">{r.responsible_bureau}</span>
      {r.case_number_snapshot && <span className="font-mono text-xs text-slate-500">{r.case_number_snapshot}</span>}
      {people && r.assigned_ada_id && people[r.assigned_ada_id] && (
        <span className="text-xs text-slate-400">ADA {people[r.assigned_ada_id]}</span>
      )}
    </button>
  )
}

export function QueueSection({ title, rows, onOpen, empty }: {
  title: string
  rows: LegalRequest[]
  onOpen: (id: string) => void
  empty?: string
}) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
        {title}
        <span className="rounded-full bg-white/10 px-1.5 text-[10px] font-bold text-slate-300">{rows.length}</span>
      </h3>
      {rows.length === 0
        ? <p className="rounded-lg border border-dashed border-white/10 px-3 py-2.5 text-xs text-slate-500">{empty ?? 'Nothing here.'}</p>
        : <div className="space-y-1.5">{rows.map((r) => <LegalRequestRow key={r.id} r={r} onOpen={onOpen} />)}</div>}
    </section>
  )
}

/** Card-based queue section — the newer surfaces render requests as accessible
 *  LegalRequestCards (one per row on mobile) instead of the flat chip row.
 *  QueueSection/LegalRequestRow are kept for existing callers. */
export function CardQueueSection({ title, rows, viewer, now, onOpen, empty }: {
  title: string
  rows: LegalRequest[]
  viewer: LegalViewer
  now: number
  onOpen: (id: string) => void
  empty?: string
}) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
        {title}
        <span className="rounded-full bg-white/10 px-1.5 text-[10px] font-bold text-slate-300">{rows.length}</span>
      </h3>
      {rows.length === 0
        ? <p className="rounded-lg border border-dashed border-white/10 px-3 py-2.5 text-xs text-slate-500">{empty ?? 'Nothing here.'}</p>
        : (
          <div className="grid gap-2">
            {rows.map((r) => (
              <LegalRequestCard key={r.id} request={r} viewer={viewer} now={now} onOpen={() => onOpen(r.id)} showClassification />
            ))}
          </div>
        )}
    </section>
  )
}
