'use client'

/** Generated Documents — derivative media rows (converted / OCR / redacted /
 *  compressed / generated). Every row records its parent and the parent's
 *  hash server-side; the original is never touched. */
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DataTable } from '@/components/ui/DataTable'
import { EmptyState } from '@/components/ui/Notice'
import { DocumentIcon } from '@/components/shell/icons'
import type { MediaRow } from '@/lib/documents'
import { derivativeTypeLabel } from '@/lib/evidence'
import { fmtDate, fmtDateTime, timeAgo } from '@/lib/format'
import { fmtBytes } from '@/lib/packets'
import { EvidenceChip, ROW_ACTION, openDocument } from './shared'

export function GeneratedDocumentsSection({ rows, parentTitle }: { rows: MediaRow[]; parentTitle: (id: string | null) => string | null }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<DocumentIcon className="h-5 w-5" />}
        title="No generated documents"
        hint="Results of the document tools — converted, OCR’d, redacted or compressed copies — appear here beside their original."
      />
    )
  }
  return (
    <DataTable<MediaRow>
      rows={rows}
      rowKey={(m) => m.id}
      dense
      countLabel="documents"
      filterPlaceholder="Filter generated documents…"
      initialSort={{ key: 'created', dir: 'desc' }}
      columns={[
        {
          key: 'title', label: 'Title', value: (m) => m.title,
          render: (m) => (
            <button type="button" onClick={() => void openDocument(m)} className="min-w-0 max-w-full truncate text-left font-medium text-white hover:underline" title={`Open ${m.title}`}>
              {m.title}
            </button>
          ),
        },
        { key: 'type', label: 'Type', value: (m) => derivativeTypeLabel(m.derivative_type), render: (m) => <Badge>{derivativeTypeLabel(m.derivative_type)}</Badge> },
        { key: 'parent', label: 'Original', value: (m) => parentTitle(m.parent_media_id) ?? '', render: (m) => <span className="truncate">{parentTitle(m.parent_media_id) ?? '—'}</span> },
        { key: 'evidence', label: 'Evidence #', value: (m) => m.evidence_number ?? m.evidence_ref ?? '', render: (m) => <EvidenceChip m={m} /> },
        { key: 'service', label: 'Service', value: (m) => [m.derivative_service, m.derivative_service_version].filter(Boolean).join(' ') },
        { key: 'size', label: 'Size', value: (m) => fmtBytes(m.byte_size), sortValue: (m) => m.byte_size ?? -1, render: (m) => <span className="tabular-nums">{fmtBytes(m.byte_size)}</span> },
        { key: 'created', label: 'Created', value: (m) => fmtDate(m.created_at), sortValue: (m) => m.created_at, render: (m) => <time dateTime={m.created_at} title={fmtDateTime(m.created_at)}>{timeAgo(m.created_at)}</time> },
        { key: 'actions', label: 'Actions', value: () => '', render: (m) => <button type="button" onClick={() => void openDocument(m)} className={ROW_ACTION} aria-label={`Open ${m.title}`}>Open</button> },
      ]}
      mobileCard={(m) => (
        <div className="rounded-lg border border-white/10 bg-ink-950/50 p-3">
          <p className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{m.title}</span>
            <Badge>{derivativeTypeLabel(m.derivative_type)}</Badge>
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            {parentTitle(m.parent_media_id) && <span className="truncate">from {parentTitle(m.parent_media_id)}</span>}
            <span className="tabular-nums">{fmtBytes(m.byte_size)}</span>
            <time dateTime={m.created_at}>{timeAgo(m.created_at)}</time>
          </p>
          <div className="mt-2"><Button size="sm" onClick={() => void openDocument(m)}>Open</Button></div>
        </div>
      )}
    />
  )
}
