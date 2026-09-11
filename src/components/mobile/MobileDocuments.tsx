'use client'

/** Documents on the phone — the packet half of the section: the case's
 *  packets (live), Download (access logged, signed URL) and Generate. The
 *  evidence-document search, tools and verification stay on the desktop. */
import { useCallback, useEffect, useState } from 'react'
import { GeneratePacketDialog } from '@/components/cases/tabs/documents/GeneratePacketDialog'
import { openMinted } from '@/components/cases/tabs/documents/shared'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { fmtDateTime, timeAgo } from '@/lib/format'
import {
  fetchPackets, fmtBytes, logPacketAccess, packetSignedUrl, packetStatusLabel, packetStatusTone, packetTypeLabel, type PacketRow,
} from '@/lib/packets'
import { officerName } from '@/lib/profiles'
import { useCaseTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import { DesktopOnlyCard, type MobileCase } from './mobileShared'

export function MobileDocuments({ c, canEdit }: { c: MobileCase; canEdit: boolean }) {
  const [rows, setRows] = useState<PacketRow[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [generateOpen, setGenerateOpen] = useState(false)
  const v = useCaseTableVersion('case_packets', c.id)
  const refresh = useCallback(async () => {
    try { setRows(await fetchPackets(c.id)); setError(null) } catch (e) { setError(e) }
  }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, v])

  const download = (p: PacketRow) => openMinted(async () => {
    const logged = await logPacketAccess(p.id)
    if (logged.error) { toast(logged.error.message, 'danger'); return null }
    return packetSignedUrl(p)
  })

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate-400">Case packets</p>
        {canEdit && <Button size="sm" variant="primary" onClick={() => setGenerateOpen(true)}>Generate Case Packet…</Button>}
      </div>
      {error ? (
        <ErrorNotice message={error} onRetry={() => void refresh()} />
      ) : rows === null ? (
        <ListSkeleton count={3} />
      ) : rows.length === 0 ? (
        <EmptyState title="No packets yet" hint="A packet renders on the server and appears here when it is ready." action={canEdit ? { label: 'Generate Case Packet…', onClick: () => setGenerateOpen(true) } : undefined} />
      ) : (
        <ul className="space-y-2" aria-label="Case packets">
          {rows.map((p) => (
            <li key={p.id} className="rounded-lg border border-white/10 bg-ink-950/50 p-3">
              <p className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-white">{packetTypeLabel(p.packet_type)}</span>
                <Badge tone={packetStatusTone(p.status)}>{packetStatusLabel(p.status)}</Badge>
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
                <span className="tabular-nums">{p.sections.length} sections</span>
                {p.byte_size != null && <span className="tabular-nums">{fmtBytes(p.byte_size)}</span>}
                {p.page_count ? <span className="tabular-nums">{p.page_count} pages</span> : null}
                <span>{officerName(p.requested_by) ?? 'Officer'}</span>
                <time dateTime={p.created_at} title={fmtDateTime(p.created_at)}>{timeAgo(p.created_at)}</time>
              </p>
              {p.status === 'failed' && p.error && <p className="mt-1 break-words text-xs text-rose-300">{p.error}</p>}
              {p.status === 'ready' && <div className="mt-2"><Button size="sm" variant="primary" onAction={() => download(p)}>Download</Button></div>}
            </li>
          ))}
        </ul>
      )}
      <DesktopOnlyCard caseId={c.id} section="documents" title="Evidence documents, page search, tools and package verification are desktop sections" />
      <GeneratePacketDialog open={generateOpen} c={c} onClose={() => setGenerateOpen(false)} onRequested={() => void refresh()} />
    </>
  )
}
