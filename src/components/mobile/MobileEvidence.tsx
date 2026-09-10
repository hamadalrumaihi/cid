'use client'

/** Evidence — the case's live media rows as cards (MediaTab's list query,
 *  archived rows hidden, bounded). Read-only: no upload, no designation, no
 *  break-glass — a restricted row the viewer may see simply carries its
 *  badge. The thumbnail goes through RecordThumb + safeUrl like the
 *  registries' cards. */
import { useCallback, useEffect, useState } from 'react'
import { list } from '@/lib/db'
import { fmtDateTime, timeAgo } from '@/lib/format'
import { officerName } from '@/lib/profiles'
import { useCaseTableVersion } from '@/lib/realtime'
import { safeUrl } from '@/lib/safeUrl'
import type { MediaRow } from '@/components/cases/tabs/shared'
import { Badge } from '@/components/ui/Badge'
import { EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { RecordThumb } from '@/components/ui/RecordThumb'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { DesktopOnlyCard, type MobileCase } from './mobileShared'

const LIMIT = 60
const mediaSrc = (m: MediaRow) => m.external_url || m.storage_path || ''

export function MobileEvidence({ c }: { c: MobileCase }) {
  const [rows, setRows] = useState<MediaRow[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const v = useCaseTableVersion('media', c.id)

  const refresh = useCallback(async () => {
    try {
      setRows(await list('media', { eq: { case_id: c.id }, is: { archived_at: null }, order: 'created_at', ascending: false, limit: LIMIT }))
      setError(null)
    } catch (e) { setError(e) }
  }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, v])

  return (
    <>
      {error ? (
        <ErrorNotice message={error} onRetry={() => void refresh()} />
      ) : rows === null ? (
        <ListSkeleton count={4} />
      ) : rows.length === 0 ? (
        <EmptyState title="No evidence yet" hint="Photos, recordings and documents attached to the case appear here." />
      ) : (
        <ul className="space-y-2" aria-label="Case evidence">
          {rows.map((m) => {
            const thumb = m.type === 'image' ? safeUrl(mediaSrc(m)) : ''
            return (
              <li key={m.id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-ink-950/50 p-3">
                <RecordThumb url={thumb || null} label={m.title} size="md" placeholder={m.type === 'video' ? 'VID' : m.type === 'document' ? 'DOC' : undefined} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">{m.title}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
                    <span>{officerName(m.uploaded_by) || 'Officer'}</span>
                    <time dateTime={m.created_at} title={fmtDateTime(m.created_at)}>{timeAgo(m.created_at)}</time>
                    {m.category && <Badge tone="neutral">{m.category}</Badge>}
                    {m.evidence_ref && <Badge tone="accent" title="Designated evidence">{m.evidence_ref}</Badge>}
                    {m.restricted && <Badge tone="danger">Restricted</Badge>}
                  </p>
                </div>
              </li>
            )
          })}
          {rows.length >= LIMIT && <li className="text-center text-xs text-slate-400">Showing the latest {LIMIT} — the desktop lists everything.</li>}
        </ul>
      )}
      <DesktopOnlyCard caseId={c.id} section="media" title="Upload and manage evidence on the desktop" />
    </>
  )
}
