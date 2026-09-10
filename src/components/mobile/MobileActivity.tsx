'use client'

/** Activity — the last 20 `case_audit_feed` rows (ActivitySection's source:
 *  every row already re-checked server-side against the viewer's own read
 *  predicate; `detail` never carries a body). Read-only, no filters, no
 *  paging — the desktop feed has both. */
import { useCallback, useEffect, useState } from 'react'
import type { Database } from '@/lib/database.types'
import { rpc } from '@/lib/db'
import { fmtDateTime, timeAgo } from '@/lib/format'
import { officerName } from '@/lib/profiles'
import { fieldLabel } from '@/components/entity/labels'
import { actionVerb, entityKindLabel } from '@/components/cases/sections/sectionShared'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { DesktopOnlyCard, type MobileCase } from './mobileShared'

type FeedRow = Database['public']['Functions']['case_audit_feed']['Returns'][number]
const LIMIT = 20

export function MobileActivity({ c }: { c: MobileCase }) {
  const [rows, setRows] = useState<FeedRow[] | null>(null)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(async () => {
    setRows(null); setError(null)
    const res = await rpc('case_audit_feed', { p_case: c.id, p_limit: LIMIT })
    if (res.error) { setError(res.error); return }
    setRows(res.data ?? [])
  }, [c.id])
  useEffect(() => { queueMicrotask(() => { void load() }) }, [load])

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-slate-400">Latest {LIMIT} changes</p>
        <Button size="sm" onClick={() => void load()}>Refresh</Button>
      </div>
      {error ? (
        <ErrorNotice message={error} onRetry={() => void load()} />
      ) : rows === null ? (
        <ListSkeleton count={5} />
      ) : rows.length === 0 ? (
        <EmptyState title="No activity to show" hint="Changes to this case and its records will appear here." />
      ) : (
        <ol className="space-y-2" aria-label="Case activity">
          {rows.map((r) => (
            <li key={r.id} className="rounded-lg border border-white/10 bg-ink-950/50 p-3 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <time dateTime={r.at} title={fmtDateTime(r.at)} className="font-mono text-xs text-slate-400">{timeAgo(r.at)}</time>
                <span className="font-semibold text-slate-200">{officerName(r.actor_id) || (r.actor_id ? 'Officer' : 'System')}</span>
                <span className="text-slate-300">{actionVerb(r.action)} {entityKindLabel(r.kind)}</span>
                {r.label && <span className="truncate text-slate-200">{r.label}</span>}
              </div>
              {r.changed_fields && r.changed_fields.length > 0 && (
                <ul className="mt-1.5 flex flex-wrap gap-1" aria-label="Changed fields">
                  {r.changed_fields.map((f) => <li key={f}><Badge tone="neutral">{fieldLabel(f)}</Badge></li>)}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
      <DesktopOnlyCard caseId={c.id} section="activity" title="Filter and load older activity on the desktop" />
    </>
  )
}
