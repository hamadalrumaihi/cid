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
  CLASSIFICATION_STYLE, deadlineInfo, type Classification, type LegalRequest,
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

/** Narrow projection for the queue/card lists — only the columns the cards and
 *  the workflow model read. Trims the wire payload versus SELECT * (the wide
 *  row carries body markdown, exhibit blobs, audit fields); RLS still scopes
 *  which rows come back, unchanged. Exported for case-scoped fetches (the
 *  case shell's Legal tab) so every card list reads the same columns. */
export const LEGAL_LIST_COLS =
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

/** The signed-in viewer's LIVE prosecutor bureau assignments — their OWN
 *  `prosecutor_bureau_assignments` rows only (the pba_sel policy always allows
 *  `prosecutor_id = auth.uid()`). Loaded once per user and cached module-wide
 *  so both portals and the dossier share one cheap read; realtime on the table
 *  refreshes it. Feeds LegalViewer.prosecutorBureaus, which activates the
 *  model's bureau-awareness lane (isBureauAwareness). Non-prosecutors skip
 *  the read entirely. */
const NO_BUREAUS: readonly string[] = []
let bureauCache: { key: string; value: readonly string[] } | null = null
export function useMyProsecutorBureaus(): readonly string[] {
  const { profile, justiceRole } = useAuth()
  // Only DOJ prosecutors can hold live routing assignments.
  const key = (justiceRole === 'assistant_district_attorney' || justiceRole === 'district_attorney')
    ? profile?.id ?? null
    : null
  const v = useTableVersion('prosecutor_bureau_assignments')
  const [bureaus, setBureaus] = useState<readonly string[]>(
    () => (key && bureauCache?.key === key ? bureauCache.value : NO_BUREAUS),
  )
  useEffect(() => {
    if (!key) return
    let cancelled = false
    void (async () => {
      try {
        const rows = await list('prosecutor_bureau_assignments', {
          select: 'bureau,starts_at,ends_at', eq: { prosecutor_id: key },
        })
        const now = Date.now()
        const live = [...new Set(
          rows.filter((r) => !r.ends_at && Date.parse(r.starts_at) <= now).map((r) => String(r.bureau)),
        )]
        bureauCache = { key, value: live }
        if (!cancelled) setBureaus(live)
      } catch { /* transient — the awareness lane just stays quiet */ }
    })()
    return () => { cancelled = true }
  }, [key, v])
  return key ? bureaus : NO_BUREAUS
}

/** Map the app's auth context → the workflow model's viewer. The model NEVER
 *  decides access (RLS + definer RPCs do); this only shapes what an authorised
 *  viewer is shown. Pass `useMyProsecutorBureaus()` so the bureau-awareness
 *  lane (isBureauAwareness) works — it defaults to none. */
export function buildLegalViewer(
  auth: ReturnType<typeof useAuth>,
  prosecutorBureaus: readonly string[] = [],
): LegalViewer {
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
    prosecutorBureaus,
  }
}

/** Card-based queue section — the newer surfaces render requests as accessible
 *  LegalRequestCards (one per row on mobile) instead of the flat chip row.
 *  `hint` renders an explanatory line under the heading (e.g. the judge
 *  parallel pickup lane, the bureau awareness lane). */
export function CardQueueSection({ title, rows, viewer, now, onOpen, empty, hint }: {
  title: string
  rows: LegalRequest[]
  viewer: LegalViewer
  now: number
  onOpen: (id: string) => void
  empty?: string
  hint?: string
}) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
        {title}
        <span className="rounded-full bg-white/10 px-1.5 text-[10px] font-bold text-slate-300">{rows.length}</span>
      </h3>
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
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
