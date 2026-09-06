'use client'

/** Bounded cross-reference list (Portal Improvements P2-06): the cases a
 *  record touches, answered by `entity_crossref` under RLS — durable intel
 *  links, surveillance sightings, report mentions, legal requests, media,
 *  MDT bulletins, matching indicators. Replaces the browser-side scans that
 *  used to pull every report/link/case the viewer could see.
 *
 *  Fails CLOSED: a failed read shows a Retry banner and never masquerades as
 *  an authoritative "no matches". Rows are grouped by case (newest sighting
 *  first, as the server orders them); each row opens the case. */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { caseLink } from '@/lib/caseLinks'
import { crossref, type CrossrefKind, type CrossrefRow } from '@/lib/entity'
import { fmtDate } from '@/lib/format'
import { bureauShort } from '@/lib/roles'
import { AlertIcon } from '@/components/shell/icons'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/Notice'
import { Skeleton } from '@/components/ui/Skeleton'

const VIA_LABEL: Record<string, string> = {
  link: 'intel link', surveillance: 'surveillance', report: 'report', legal: 'legal request',
  media: 'media', mdt: 'MDT bulletin', indicator: 'indicator', person: 'linked person',
}

interface CaseGroup { case_id: string; case_number: string; title: string | null; bureau: string; hits: CrossrefRow[] }

/** Group server rows by case, keeping the server's newest-first order. */
export function groupCrossref(rows: readonly CrossrefRow[]): CaseGroup[] {
  const byCase = new Map<string, CaseGroup>()
  for (const r of rows) {
    const g = byCase.get(r.case_id)
    if (g) g.hits.push(r)
    else byCase.set(r.case_id, { case_id: r.case_id, case_number: r.case_number, title: r.title, bureau: r.bureau, hits: [r] })
  }
  return [...byCase.values()]
}

export function CrossrefList({ kind, id, q, limit, emptyTitle = 'No linked cases', emptyHint, className = '' }: {
  kind: CrossrefKind
  /** The record id; null only for kind 'phone' (pass the number as `q`). */
  id: string | null
  q?: string
  limit?: number
  emptyTitle?: string
  emptyHint?: string
  className?: string
}) {
  const [state, setState] = useState<'loading' | 'failed' | 'done'>('loading')
  const [rows, setRows] = useState<CrossrefRow[]>([])
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let cancelled = false
    // Deferred (the registry idiom): the read starts on the next tick so the
    // effect body never sets state synchronously.
    const t = window.setTimeout(async () => {
      setState('loading')
      try {
        const r = await crossref(kind, id, { limit, q })
        if (!cancelled) { setRows(r); setState('done') }
      } catch {
        if (!cancelled) setState('failed')
      }
    }, 0)
    return () => { cancelled = true; window.clearTimeout(t) }
  }, [kind, id, q, limit, retry])

  const groups = useMemo(() => groupCrossref(rows), [rows])

  if (state === 'loading') {
    return (
      <div role="status" aria-busy="true" className={`space-y-2 ${className}`}>
        <span className="sr-only">Cross-referencing cases…</span>
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    )
  }
  if (state === 'failed') {
    return (
      <div className={`rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-200 ${className}`}>
        <AlertIcon size={14} className="inline align-[-2px]" /> Could not cross-reference cases (connection issue).{' '}
        <button onClick={() => setRetry((n) => n + 1)} className="rounded p-1 font-semibold underline">Retry</button>
      </div>
    )
  }
  if (!groups.length) return <EmptyState title={emptyTitle} hint={emptyHint} className={className} />
  return (
    <ul className={`space-y-2 ${className}`}>
      {groups.map((g) => (
        <li key={g.case_id} className="rounded-lg border border-white/5 bg-ink-900 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={caseLink(g.case_id)} className="min-h-[24px] font-mono text-sm text-blue-300 hover:underline">{g.case_number}</Link>
            {g.title && <span className="min-w-0 truncate text-sm text-slate-200">{g.title}</span>}
            <span className="text-xs text-slate-400">{bureauShort(g.bureau)}</span>
          </div>
          <ul className="mt-1.5 space-y-1">
            {g.hits.map((h, i) => (
              <li key={`${h.via}:${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
                <Badge tone="neutral">{VIA_LABEL[h.via] ?? h.via}</Badge>
                {h.detail && <span className="min-w-0 truncate text-slate-300">{h.detail}</span>}
                <span className="ml-auto whitespace-nowrap">{fmtDate(h.observed_at)}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}
