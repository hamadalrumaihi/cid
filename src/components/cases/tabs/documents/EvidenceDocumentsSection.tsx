'use client'

/** Evidence Documents — the case's original documents (PDF / text / DOCX
 *  media rows) with their extraction state, plus "Search inside documents"
 *  over the extracted pages (`document_search`, RLS through document_pages
 *  → media). Open mints a signed URL and records the view; "Open page N"
 *  deep-links the viewer with `#page=N`. */
import { useState, type FormEvent } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DataTable } from '@/components/ui/DataTable'
import { Field, Input } from '@/components/ui/Field'
import { EmptyState } from '@/components/ui/Notice'
import { DocumentIcon } from '@/components/shell/icons'
import {
  EXTRACTION_LABEL, EXTRACTION_TONE, canRequestExtraction, splitHeadline, type DocumentSearchHit, type EvidenceDocument, type MediaRow,
} from '@/lib/documents'
import { fmtDate, fmtDateTime, timeAgo } from '@/lib/format'
import { officerName } from '@/lib/profiles'
import { documentService } from '@/lib/services/documents/document-service'
import { toast } from '@/lib/toast'
import { EvidenceChip, ROW_ACTION, openDocument } from './shared'

export function EvidenceDocumentsSection({ caseId, docs, resolveMedia, onChanged }: {
  caseId: string
  docs: EvidenceDocument[]
  /** Find the media row behind a search hit (documents, generated rows, or
   *  a fetch for anything else the viewer may read). */
  resolveMedia: (id: string) => Promise<MediaRow | null>
  onChanged: () => void
}) {
  const process = async (d: EvidenceDocument) => {
    const r = await documentService.requestExtraction(d.media.id)
    if (!r.ok) { toast(r.message ?? 'Processing was refused.', 'danger'); return }
    toast('Processing started — you’ll be notified when the document is searchable.', 'success')
    onChanged()
  }

  return (
    <div className="space-y-4">
      <PageSearch caseId={caseId} resolveMedia={resolveMedia} />
      {docs.length === 0 ? (
        <EmptyState
          icon={<DocumentIcon className="h-5 w-5" />}
          title="No evidence documents"
          hint="PDFs, text and Word files uploaded as evidence appear here with their page extraction status."
        />
      ) : (
        <DataTable<EvidenceDocument>
          rows={docs}
          rowKey={(d) => d.media.id}
          dense
          countLabel="documents"
          filterPlaceholder="Filter documents…"
          initialSort={{ key: 'created', dir: 'desc' }}
          columns={[
            {
              key: 'title', label: 'Title', value: (d) => d.media.title,
              render: (d) => (
                <button type="button" onClick={() => void openDocument(d.media)} className="min-w-0 max-w-full truncate text-left font-medium text-white hover:underline" title={`Open ${d.media.title}`}>
                  {d.media.title}
                </button>
              ),
            },
            { key: 'evidence', label: 'Evidence #', value: (d) => d.media.evidence_number ?? d.media.evidence_ref ?? '', render: (d) => <EvidenceChip m={d.media} /> },
            { key: 'pages', label: 'Pages', value: (d) => (d.extraction?.page_count ? String(d.extraction.page_count) : ''), render: (d) => <span className="tabular-nums">{d.extraction?.page_count ?? '—'}</span>, sortValue: (d) => d.extraction?.page_count ?? -1 },
            {
              key: 'status', label: 'Extraction', value: (d) => EXTRACTION_LABEL[d.state],
              render: (d) => (
                <span className="inline-flex flex-wrap items-center gap-2">
                  <Badge tone={EXTRACTION_TONE[d.state]} title={d.extraction?.error ?? undefined}>{EXTRACTION_LABEL[d.state]}</Badge>
                  {canRequestExtraction(d.media, d.state) && <Button size="sm" onAction={() => process(d)}>{d.state === 'failed' ? 'Retry' : 'Process'}</Button>}
                </span>
              ),
            },
            { key: 'uploaded', label: 'Uploaded by', value: (d) => officerName(d.media.uploaded_by) ?? '' },
            { key: 'created', label: 'Added', value: (d) => fmtDate(d.media.created_at), sortValue: (d) => d.media.created_at, render: (d) => <time dateTime={d.media.created_at} title={fmtDateTime(d.media.created_at)}>{timeAgo(d.media.created_at)}</time> },
            {
              key: 'actions', label: 'Actions', value: () => '',
              render: (d) => <button type="button" onClick={() => void openDocument(d.media)} className={ROW_ACTION} aria-label={`Open ${d.media.title}`}>Open</button>,
            },
          ]}
          mobileCard={(d) => (
            <div className="rounded-lg border border-white/10 bg-ink-950/50 p-3">
              <p className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => void openDocument(d.media)} className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-white">{d.media.title}</button>
                <EvidenceChip m={d.media} />
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <Badge tone={EXTRACTION_TONE[d.state]}>{EXTRACTION_LABEL[d.state]}</Badge>
                {d.extraction?.page_count ? <span className="tabular-nums">{d.extraction.page_count} pages</span> : null}
                <time dateTime={d.media.created_at}>{timeAgo(d.media.created_at)}</time>
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void openDocument(d.media)}>Open</Button>
                {canRequestExtraction(d.media, d.state) && <Button size="sm" onAction={() => process(d)}>{d.state === 'failed' ? 'Retry' : 'Process'}</Button>}
              </div>
            </div>
          )}
        />
      )}
    </div>
  )
}

/** "Search inside documents" — the page-level FTS box and its hit list. */
function PageSearch({ caseId, resolveMedia }: { caseId: string; resolveMedia: (id: string) => Promise<MediaRow | null> }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<DocumentSearchHit[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [searched, setSearched] = useState('')

  const run = async (e?: FormEvent) => {
    e?.preventDefault()
    const term = q.trim()
    if (!term || busy) return
    setBusy(true)
    try {
      const r = await documentService.searchPages(term, caseId, 30)
      if (r.error) { toast(r.error.message, 'danger'); return }
      setHits(r.data ?? [])
      setSearched(term)
    } finally {
      setBusy(false)
    }
  }
  const openHit = async (h: DocumentSearchHit) => {
    const m = await resolveMedia(h.media_id)
    if (!m) { toast('That document is no longer available to you.', 'danger'); return }
    await openDocument(m, h.page_no)
  }

  return (
    <section aria-label="Search inside documents" className="rounded-lg border border-white/10 bg-ink-950/40 p-3">
      <form onSubmit={(e) => void run(e)} className="flex flex-wrap items-end gap-2">
        <Field label="Search inside documents" className="min-w-0 flex-1 basis-64">
          {(id) => (
            <Input id={id} type="search" name="document_search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. plate number, address, name…" autoComplete="off" spellCheck={false} enterKeyHint="search" />
          )}
        </Field>
        <Button type="submit" variant="primary" loading={busy} disabled={!q.trim()}>Search</Button>
        <p className="w-full text-xs text-slate-400">Full-text over the extracted pages of this case’s documents. Processed documents only.</p>
      </form>
      {hits && (
        <div className="mt-3" aria-live="polite">
          {hits.length === 0 ? (
            <p className="text-sm text-slate-400">No pages match “{searched}”.</p>
          ) : (
            <ul className="divide-y divide-white/5" aria-label="Page hits">
              {hits.map((h, i) => (
                <li key={`${h.media_id}-${h.page_no}-${i}`} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="flex flex-wrap items-center gap-2 text-sm text-white">
                      <span className="truncate font-medium">{h.title}</span>
                      {h.evidence_number && <Badge tone="accent"><span className="font-mono" translate="no">{h.evidence_number}</span></Badge>}
                      <span className="text-xs text-slate-400 tabular-nums">Page {h.page_no}</span>
                    </p>
                    <p className="mt-0.5 line-clamp-2 break-words text-xs text-slate-300">
                      {splitHeadline(h.headline).map((seg, j) => seg.hit
                        ? <mark key={j} className="rounded bg-badge-500/30 px-0.5 text-badge-100">{seg.text}</mark>
                        : <span key={j}>{seg.text}</span>)}
                    </p>
                  </div>
                  <Button size="sm" onAction={() => openHit(h)}>Open page {h.page_no}</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
