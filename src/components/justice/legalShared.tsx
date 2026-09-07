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
import { effectiveDojRole } from '@/lib/permissions'
import type { LegalViewer } from '@/lib/legalWorkflow'
import { deadlineInfo, type LegalRequest } from '@/lib/justice'
import { LEGAL_TONE_CLS, legalReviewTone, type LegalTone } from '@/lib/status'
import { AccessBadge } from '@/components/ui/AccessBadge'
import { LegalRequestCard } from './LegalRequestCard'

/** Kept as a thin wrapper for the existing call sites — the rendering (and
 *  the who-can-access tooltip) now lives in ui/AccessBadge. */
export function ClassificationBadge({ value }: { value: string }) {
  return <AccessBadge kind="legal" value={value} />
}

export function StatusChip({ label, tone = 'slate' }: { label: string; tone?: LegalTone }) {
  // Tone → class map lives in the central status registry (lib/status), so
  // this chip can never drift from the legalReview domain's colors.
  return <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold ${LEGAL_TONE_CLS[tone]}`}>{label}</span>
}

/** Review-status → tone, from the central registry (single source of truth). */
export const reviewTone = legalReviewTone

/** Deadline/expiry warning chip for a LEGAL REQUEST row. Renamed from
 *  DeadlineChip to end the name collision with ui/DeadlineChip (the generic
 *  date-countdown chip) — they take different props and mean different
 *  things. */
export function LegalDeadlineChip({ request }: { request: Pick<LegalRequest, 'expires_at' | 'response_deadline' | 'fulfilment_status'> }) {
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
  'submitted_to_doj_at,created_by,priority,created_at,updated_at,current_version_id,' +
  // historical prosecutor-stage columns (retired by P4-01, still rendered) +
  // the amendment / supersession links
  'assigned_prosecutor_id,prosecutor_claimed_at,queue_entered_at,submitted_to_judge_at,' +
  'amends_request_id,superseded_by_id,' +
  // SLA columns (P4-10): stage clock + the reminder sweep's marks (slaChips)
  'stage_entered_at,nudged_at,escalated_at'

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

/** @deprecated The prosecutor role and its bureau lanes are retired (P4-01,
 *  L16): there is no bureau-awareness lane to feed any more, so this always
 *  returns an empty, stable array. Kept as a no-op only so the remaining
 *  call sites (dossier, case shell) keep compiling until they drop it;
 *  do not add new callers. */
const NO_BUREAUS: readonly string[] = []
export function useMyProsecutorBureaus(): readonly string[] {
  return NO_BUREAUS
}

/* The effective-DOJ-role mirror and the viewer's own role hook live in
 * @/lib/permissions now (effectiveDojRole / useMyJusticeRole): one source,
 * server-first through my_permissions(). */

/** Map the app's auth context → the workflow model's viewer. The model NEVER
 *  decides access (RLS + definer RPCs do); this only shapes what an authorised
 *  viewer is shown. Pass `useMyJusticeRole()` for the expiry-aware effective
 *  role; callers that omit it fall back to mapping the auth context's active
 *  membership (no expiry check — the server enforces it regardless).
 *
 *  The second positional argument used to carry the viewer's prosecutor
 *  bureaus; the lane is gone (P4-01) and the value is ignored. It stays in
 *  the signature so existing four-argument calls keep compiling. */
export function buildLegalViewer(
  auth: ReturnType<typeof useAuth>,
  _retiredProsecutorBureaus?: readonly string[] | null,
  justiceRole?: LegalViewer['justiceRole'],
  /** SIU command standing, from useSiu().isCommand. Passed in rather than read
   *  here because this builder has no SIU context; omitted it reads as false,
   *  which only ever hides an action the server would have allowed — never the
   *  other way round. */
  siuIsCommand = false,
): LegalViewer {
  const p = auth.profile
  return {
    myId: p?.id ?? null,
    cidActive: p?.active ?? false,
    cidRole: p?.role ?? null,
    cidDivision: p?.division ?? null,
    justiceRole: justiceRole !== undefined ? justiceRole : effectiveDojRole(auth.justiceRole),
    isOwner: auth.isOwner,
    siuIsCommand,
  }
}

/** Card-based queue section — the newer surfaces render requests as accessible
 *  LegalRequestCards (one per row on mobile) instead of the flat chip row.
 *  `hint` renders an explanatory line under the heading (e.g. the open
 *  judicial queue a judge may claim from). */
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
      <h3 className="flex items-center gap-2 text-[13px] font-semibold text-white">
        {title}
        <span className="rounded-full bg-white/10 px-1.5 text-[10px] font-semibold text-slate-300">{rows.length}</span>
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
