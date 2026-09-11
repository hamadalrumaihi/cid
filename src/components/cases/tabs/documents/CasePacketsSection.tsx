'use client'

/** Case Packets — every server-rendered packet of the case: type, sections,
 *  live status (the parent refetches on the realtime `case_packets`
 *  channel), requester, size / pages, and the actions: Download (access is
 *  logged FIRST, then the 300 s signed URL opens), Verify package, Cancel
 *  (queued, own or Owner), Retry (Owner). A failed packet shows its error. */
import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DataTable } from '@/components/ui/DataTable'
import { EmptyState } from '@/components/ui/Notice'
import { uiPrompt } from '@/components/ui/dialog'
import { DocumentIcon } from '@/components/shell/icons'
import { useAuth } from '@/lib/auth'
import { fmtDate, fmtDateTime, timeAgo } from '@/lib/format'
import { officerName } from '@/lib/profiles'
import {
  cancelJob, fmtBytes, logPacketAccess, packetCancellable, packetRetryable, packetSignedUrl, packetStatusLabel, packetStatusTone,
  packetTypeLabel, retryJob, type PacketRow,
} from '@/lib/packets'
import { toast } from '@/lib/toast'
import { VerifyPackageDialog } from './VerifyPackageDialog'
import { openMinted } from './shared'

export function CasePacketsSection({ packets, onGenerate, onChanged }: { packets: PacketRow[]; onGenerate: () => void; onChanged: () => void }) {
  const { profile, isOwner } = useAuth()
  const viewerId = profile?.id ?? null
  const [verifying, setVerifying] = useState<PacketRow | null>(null)

  const download = async (p: PacketRow) => {
    await openMinted(async () => {
      const logged = await logPacketAccess(p.id)
      if (logged.error) { toast(logged.error.message, 'danger'); return null }
      return packetSignedUrl(p)
    })
  }
  const cancel = async (p: PacketRow) => {
    if (!p.job_id) return
    const reason = await uiPrompt('Optional reason — recorded in the audit log.', { title: 'Cancel packet', confirmText: 'Cancel packet' })
    if (reason === null) return
    const r = await cancelJob(p.job_id, reason.trim() || 'Cancelled by requester')
    if (!r.ok) { toast(r.message ?? 'Could not cancel the packet.', 'danger'); return }
    toast('Packet cancelled.', 'success')
    onChanged()
  }
  const retry = async (p: PacketRow) => {
    if (!p.job_id) return
    const r = await retryJob(p.job_id)
    if (!r.ok) { toast(r.message ?? 'Could not retry the packet.', 'danger'); return }
    toast('Packet re-queued.', 'success')
    onChanged()
  }
  const mayCancel = (p: PacketRow) => packetCancellable(p) && (isOwner || (!!viewerId && p.requested_by === viewerId))
  const mayRetry = (p: PacketRow) => isOwner && packetRetryable(p)

  const actions = (p: PacketRow) => (
    <span className="flex flex-wrap items-center gap-1">
      {p.status === 'ready' && <Button size="sm" variant="primary" onAction={() => download(p)}>Download</Button>}
      {p.status === 'ready' && p.manifest_id && <Button size="sm" onClick={() => setVerifying(p)}>Verify package</Button>}
      {mayCancel(p) && <Button size="sm" onAction={() => cancel(p)}>Cancel</Button>}
      {mayRetry(p) && <Button size="sm" onAction={() => retry(p)}>Retry</Button>}
    </span>
  )
  const statusCell = (p: PacketRow) => (
    <span className="inline-flex flex-col gap-0.5">
      <Badge tone={packetStatusTone(p.status)} className="self-start">{packetStatusLabel(p.status)}</Badge>
      {p.status === 'failed' && p.error && <span className="max-w-xs break-words text-xs text-rose-300">{p.error}</span>}
    </span>
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-400">
          Server-rendered packets with a manifest and SHA-256 per file. Downloads are recorded.
        </p>
        <Button variant="primary" size="sm" onClick={onGenerate}>Generate Case Packet…</Button>
      </div>
      {packets.length === 0 ? (
        <EmptyState
          icon={<DocumentIcon className="h-5 w-5" />}
          title="No packets yet"
          hint="Generate a packet for court, command or disclosure. It renders in the background and you are notified when it is ready."
          action={{ label: 'Generate Case Packet…', onClick: onGenerate }}
        />
      ) : (
        <DataTable<PacketRow>
          rows={packets}
          rowKey={(p) => p.id}
          dense
          countLabel="packets"
          filterPlaceholder="Filter packets…"
          initialSort={{ key: 'requested', dir: 'desc' }}
          columns={[
            { key: 'type', label: 'Type', value: (p) => packetTypeLabel(p.packet_type), render: (p) => <span className="font-medium text-white">{packetTypeLabel(p.packet_type)}</span> },
            { key: 'sections', label: 'Sections', value: (p) => String(p.sections.length), sortValue: (p) => p.sections.length, render: (p) => <span className="tabular-nums" title={p.sections.join(', ')}>{p.sections.length}</span> },
            { key: 'status', label: 'Status', value: (p) => packetStatusLabel(p.status), render: statusCell },
            { key: 'by', label: 'Requested by', value: (p) => officerName(p.requested_by) ?? '' },
            { key: 'requested', label: 'Requested', value: (p) => fmtDate(p.created_at), sortValue: (p) => p.created_at, render: (p) => <time dateTime={p.created_at} title={fmtDateTime(p.created_at)}>{timeAgo(p.created_at)}</time> },
            { key: 'size', label: 'Size / pages', value: (p) => `${fmtBytes(p.byte_size)}${p.page_count ? ` · ${p.page_count} p.` : ''}`, sortValue: (p) => p.byte_size ?? -1, render: (p) => <span className="tabular-nums">{p.byte_size != null ? fmtBytes(p.byte_size) : '—'}{p.page_count ? ` · ${p.page_count} pages` : ''}</span> },
            { key: 'watermark', label: 'Watermark', value: (p) => p.watermark ?? '', render: (p) => p.watermark ? <span className="truncate text-xs text-slate-300" title={p.watermark}>{p.watermark}</span> : <span className="text-slate-500">—</span> },
            { key: 'actions', label: 'Actions', value: () => '', render: actions },
          ]}
          mobileCard={(p) => (
            <div className="rounded-lg border border-white/10 bg-ink-950/50 p-3">
              <p className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-white">{packetTypeLabel(p.packet_type)}</span>
                <Badge tone={packetStatusTone(p.status)}>{packetStatusLabel(p.status)}</Badge>
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span className="tabular-nums">{p.sections.length} sections</span>
                {p.byte_size != null && <span className="tabular-nums">{fmtBytes(p.byte_size)}</span>}
                {p.page_count ? <span className="tabular-nums">{p.page_count} pages</span> : null}
                <span>{officerName(p.requested_by) ?? 'Officer'}</span>
                <time dateTime={p.created_at}>{timeAgo(p.created_at)}</time>
              </p>
              {p.status === 'failed' && p.error && <p className="mt-1 break-words text-xs text-rose-300">{p.error}</p>}
              <div className="mt-2">{actions(p)}</div>
            </div>
          )}
        />
      )}
      <VerifyPackageDialog open={!!verifying} packet={verifying} onClose={() => setVerifying(null)} />
    </div>
  )
}
