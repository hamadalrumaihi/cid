'use client'

/** Registry "Legal" sections for vehicles and places (DOJ redesign phase 5),
 *  mirroring the person dossier's structured legal section (ProfileLegal):
 *  legal instruments come EXCLUSIVELY from the structured
 *  `legal_request_exhibits` target rows (exhibit_type 'vehicle' / 'place' +
 *  source_id) — no plate/name text-scanning. RLS is the authority twice over:
 *  the exhibits SELECT policy (lre_sel) only returns rows whose parent passes
 *  can_view_legal_request, and the parent fetch is trimmed the same way — a
 *  sealed or out-of-scope request never appears and is never hinted at, so the
 *  empty state deliberately reads "no VISIBLE legal activity". */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Tables } from '@/lib/database.types'
import { list } from '@/lib/db'
import { fmtDate } from '@/lib/format'
import { fulfilmentLabel, reviewStatusLabel } from '@/lib/justice'
import { humanize } from '@/lib/legalWorkflow'
import { useTableVersion } from '@/lib/realtime'
import { useNow } from '@/lib/useNow'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { DeadlineChip } from '@/components/ui/DeadlineChip'
import { EntityLink } from '@/components/ui/EntityLink'
import { EmptyState } from '@/components/ui/Notice'
import { Skeleton } from '@/components/ui/Skeleton'

/** Narrow parent projection — only what the compact row + labels read. */
const REF_REQUEST_COLS =
  'id,request_number,title,request_type,subtype,review_status,fulfilment_status,'
  + 'classification,case_id,case_number_snapshot,response_deadline,expires_at,created_at'

export type EntityLegalRequest = Pick<Tables<'legal_requests'>,
  | 'id' | 'request_number' | 'title' | 'request_type' | 'subtype'
  | 'review_status' | 'fulfilment_status' | 'classification'
  | 'case_id' | 'case_number_snapshot' | 'response_deadline' | 'expires_at' | 'created_at'>

type ExhibitRef = Pick<Tables<'legal_request_exhibits'>,
  'id' | 'legal_request_id' | 'source_id' | 'rationale' | 'created_at'>

export interface EntityLegalRef {
  exhibitId: string
  /** Per-target rationale recorded on the exhibit row (why this target). */
  rationale: string | null
  request: EntityLegalRequest
}

/** All visible legal references for one exhibit kind, keyed by source_id.
 *  Omitting `sourceId` batches the whole registry (PlacesView grid — one
 *  round-trip pair instead of one per card). RLS trims both legs; a reference
 *  whose parent row does not come back is dropped, never rendered as a stub. */
export async function fetchEntityLegalRefs(
  exhibitType: 'vehicle' | 'place',
  sourceId?: string,
): Promise<Map<string, EntityLegalRef[]>> {
  const exhibits = (await list('legal_request_exhibits', {
    select: 'id,legal_request_id,source_id,rationale,created_at',
    eq: { exhibit_type: exhibitType, ...(sourceId ? { source_id: sourceId } : {}) },
    order: 'created_at',
    ascending: false,
  })) as unknown as ExhibitRef[]
  const ids = [...new Set(exhibits.map((e) => e.legal_request_id))]
  const requests = ids.length
    ? ((await list('legal_requests', { select: REF_REQUEST_COLS, in: { id: ids } })) as unknown as EntityLegalRequest[])
    : []
  const byId = new Map(requests.map((r) => [r.id, r]))
  const out = new Map<string, EntityLegalRef[]>()
  const seen = new Set<string>()
  for (const e of exhibits) {
    if (!e.source_id) continue
    const request = byId.get(e.legal_request_id)
    if (!request) continue // parent trimmed by RLS — drop the reference entirely
    const key = `${e.source_id}:${e.legal_request_id}` // one row per request per target
    if (seen.has(key)) continue
    seen.add(key)
    out.set(e.source_id, [...(out.get(e.source_id) ?? []), { exhibitId: e.id, rationale: e.rationale, request }])
  }
  return out
}

/** Legal references for ONE record. Fails CLOSED: a query error shows a Retry
 *  banner, never a false "no visible legal activity" (LinkedCasesPanel idiom). */
function useEntityLegalRefs(exhibitType: 'vehicle' | 'place', sourceId: string): {
  state: 'loading' | 'failed' | 'done'
  refs: EntityLegalRef[]
  retry: () => void
} {
  const [state, setState] = useState<'loading' | 'failed' | 'done'>('loading')
  const [refs, setRefs] = useState<EntityLegalRef[]>([])
  const [tick, setTick] = useState(0)
  const v = useTableVersion('legal_requests')
  useEffect(() => {
    let cancelled = false
    const t = window.setTimeout(async () => {
      setState('loading')
      try {
        const map = await fetchEntityLegalRefs(exhibitType, sourceId)
        if (cancelled) return
        setRefs(map.get(sourceId) ?? [])
        setState('done')
      } catch {
        if (!cancelled) setState('failed')
      }
    }, 0)
    return () => { cancelled = true; window.clearTimeout(t) }
  }, [exhibitType, sourceId, v, tick])
  return { state, refs, retry: () => setTick((n) => n + 1) }
}

/** "Warrant — Search Warrant" (ProfileLegal's legalTypeLabel, model humanize). */
const typeLabel = (r: Pick<EntityLegalRequest, 'request_type' | 'subtype'>): string =>
  `${humanize(r.request_type)}${r.subtype && r.subtype !== r.request_type ? ` — ${humanize(r.subtype)}` : ''}`

/** Full row (vehicle profile panel) — mirrors the person dossier's LegalRow,
 *  plus the per-target rationale when the exhibit carries one. */
function LegalRefRow({ r, now }: { r: EntityLegalRef; now: number }) {
  const router = useRouter()
  const req = r.request
  return (
    <Card pad="sm">
      <button
        onClick={() => router.push(`/legal?request=${encodeURIComponent(req.id)}`)}
        className="text-left text-sm font-semibold text-white hover:text-blue-200"
        title="Open in Legal Requests"
      >
        <span className="font-mono text-blue-300">{req.request_number}</span>
        <span className="font-normal text-slate-400"> · {req.title || typeLabel(req)}</span>
      </button>
      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
        <Badge tone="neutral">{typeLabel(req)}</Badge>
        <Badge tone="accent">{reviewStatusLabel(req.review_status)}</Badge>
        <Badge tone="neutral">{fulfilmentLabel(req.fulfilment_status)}</Badge>
        <DeadlineChip at={req.response_deadline} kind="deadline" now={now} />
        <DeadlineChip at={req.expires_at} kind="expires" now={now} />
        <span>Filed {fmtDate(req.created_at)}</span>
        {req.case_id && (
          <EntityLink kind="case" id={req.case_id} label={req.case_number_snapshot || 'Source case'} title="Open the source case" />
        )}
      </p>
      {r.rationale && (
        <p className="mt-1.5 text-xs text-slate-400">
          <span className="font-semibold text-slate-300">Why this target:</span> {r.rationale}
        </p>
      )}
    </Card>
  )
}

/** Compact line (place cards) — a linked request chip plus the rationale. */
export function EntityLegalLine({ r }: { r: EntityLegalRef }) {
  const router = useRouter()
  const req = r.request
  return (
    <div className="min-w-0">
      <button
        onClick={() => router.push(`/legal?request=${encodeURIComponent(req.id)}`)}
        title={`Open ${req.request_number}${req.title ? ` — ${req.title}` : ''}`}
        className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-blue-200 transition hover:bg-white/10"
      >
        <span aria-hidden>⚖️</span>
        <span className="font-mono">{req.request_number}</span>
        <span className="truncate text-slate-300">{reviewStatusLabel(req.review_status)}</span>
      </button>
      {r.rationale && <p className="mt-0.5 text-[11px] text-slate-400">{r.rationale}</p>}
    </div>
  )
}

/** Self-loading "Legal" panel for a single record's profile (vehicle today;
 *  any future dossier surface with a canonical id can reuse it). */
export function EntityLegalPanel({ exhibitType, sourceId, noun }: {
  exhibitType: 'vehicle' | 'place'
  sourceId: string
  /** Lowercase noun for the empty-state copy ("vehicle", "place"). */
  noun: string
}) {
  const { state, refs, retry } = useEntityLegalRefs(exhibitType, sourceId)
  const now = useNow()
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-blue-300/70">Legal</h3>
        {state === 'done' && refs.length > 0 && <span className="text-[11px] text-slate-400">{refs.length}</span>}
      </div>
      {state === 'loading' ? (
        <div role="status" aria-busy="true" className="space-y-2">
          <span className="sr-only">Loading legal references…</span>
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      ) : state === 'failed' ? (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-200">
          ⚠ Could not load legal references (connection issue).{' '}
          <button onClick={retry} className="rounded p-1 font-semibold underline">Retry</button>
        </div>
      ) : !refs.length ? (
        <EmptyState
          title="NO VISIBLE LEGAL ACTIVITY"
          hint={`Legal requests naming this ${noun} as a structured target appear here when they are within your access.`}
        />
      ) : (
        <div className="space-y-2">
          {refs.map((r) => <LegalRefRow key={r.exhibitId} r={r} now={now} />)}
        </div>
      )}
    </Card>
  )
}
