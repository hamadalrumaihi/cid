'use client'

/** Evidence detail — the right-hand sheet for one designated evidence row.
 *  Everything the request lists: identity (EV number, case, title, type,
 *  classification), the file facts captured at ingest (filename, MIME, size,
 *  SHA-256), provenance (uploaded / collected by + when, location, source),
 *  custody (current custodian, the append-only event trail with the server's
 *  hash-chain verdict), lineage (original vs derivative + parent), processing
 *  jobs, export manifests and the related records.
 *
 *  Descriptive fields (title, category, classification, collected by/at,
 *  location, source) are editable through a plain `update('media', …)` — the
 *  integrity/custody/derivative columns are trigger-locked to the evidence
 *  service and never written here. Every action is a definer RPC.
 *
 *  Storage-hosted bytes are reached through 300 s signed URLs; opening the
 *  sheet logs a VIEWED custody event, Download logs DOWNLOADED (restricted
 *  rows also keep the D6 restricted-access log). Legacy external rows show
 *  a neutral "integrity not tracked" line and skip the custody surfaces
 *  they cannot have. Single column under `useNarrow()`. */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ActionMenu } from '@/components/ui/ActionMenu'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EntityLink } from '@/components/ui/EntityLink'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { AlertIcon, CheckIcon, FileTypeIcon } from '@/components/shell/icons'
import { caseLink } from '@/lib/caseLinks'
import { CASE_MEDIA_CATEGORIES, caseMediaCategoryLabel } from '@/lib/caseMedia'
import { update } from '@/lib/db'
import {
  CLASSIFICATIONS, classificationLabel, custodyEventLabel, derivativeTypeLabel, evidenceDownloadUrl, evidenceNumberOf,
  fetchCustody, fetchDerivatives, fetchExportHistory, fetchMediaJobs, fetchRelatedReportIds, integrityFailureDetail,
  isExternalHosted, isRegisteredEvidence, isStorageHosted, jobKindLabel, jobProgressOf, jobStatusTone, logEvidenceAccess,
  sha256HexOf, useEvidenceSealingFlag, useMediaSrc, verifyChain,
  type BackgroundJobRow, type ChainVerifyResult, type CustodyEventRow, type ExportManifestRow, type MediaRow,
} from '@/lib/evidence'
import { copyText, fmtDateTime } from '@/lib/format'
import { formatBytes, shortHash } from '@/lib/hash'
import { activeProfiles, officerName } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { safeUrl } from '@/lib/safeUrl'
import { toast } from '@/lib/toast'
import { useNarrow } from '@/lib/useNarrow'
import { evidenceMenuItems } from './evidenceActions'
import { ExternalHostLine, IntegrityBadge } from './IntegrityBadge'
import { TransferCustodyDialog } from './TransferCustodyDialog'

export interface RelatedRecord {
  key: string
  kind: 'person' | 'vehicle' | 'gang' | 'place' | 'narcotic'
  id: string
  label: string
}

interface Loaded {
  custody: CustodyEventRow[]
  chain: ChainVerifyResult | null
  derivatives: MediaRow[]
  jobs: BackgroundJobRow[]
  manifests: ExportManifestRow[]
  reportIds: string[]
}

/** ISO ↔ `<input type="datetime-local">` (local wall-clock, minute precision). */
const toLocalInput = (iso: string | null): string => {
  if (!iso) return ''
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fromLocalInput = (v: string): string | null => {
  if (!v) return null
  const d = new Date(v)
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

const EVIDENCE_TYPE_LABEL: Record<MediaRow['type'], string> = { image: 'Image', video: 'Video', fivemanage: 'Audio', document: 'Document' }

export function EvidenceDetailSheet({ m, caseId, caseNumber, parent, canEdit, isCommand, related, reportLabel, onClose, onChanged, onOpenMediaOptions, onOpenRow }: {
  m: MediaRow
  caseId: string
  caseNumber: string
  /** The parent row when `m` is a derivative (resolved by the tab). */
  parent?: MediaRow | null
  canEdit: boolean
  isCommand: boolean
  related: RelatedRecord[]
  reportLabel: (id: string | null) => string | null
  onClose: () => void
  onChanged: () => void
  /** Opens the general media modal (feature / archive / links / delete). */
  onOpenMediaOptions: () => void
  /** Navigate the sheet to another row (a derivative or the parent). */
  onOpenRow: (id: string) => void
}) {
  const narrow = useNarrow()
  const storage = isStorageHosted(m)
  const registered = isRegisteredEvidence(m) && storage
  const sealingEnabled = useEvidenceSealingFlag()
  const src = useMediaSrc(m)
  const safe = safeUrl(src ?? '')
  const vC = useTableVersion('evidence_custody_events')
  const vJ = useTableVersion('background_jobs')
  const vM = useTableVersion('media')

  // View trail — once per open (the server de-dupes per actor / 10 min).
  useEffect(() => { logEvidenceAccess(m, 'viewed') }, [m.id, m.restricted, m.evidence_number]) // eslint-disable-line react-hooks/exhaustive-deps -- keyed on the identity fields only

  const [data, setData] = useState<Loaded | null>(null)
  const [loadError, setLoadError] = useState(false)
  const load = useCallback(async () => {
    try {
      const [custody, chain, derivatives, jobs, manifests, reportIds] = await Promise.all([
        registered ? fetchCustody(m.id) : Promise.resolve([] as CustodyEventRow[]),
        registered ? verifyChain(m.id) : Promise.resolve(null),
        fetchDerivatives(m.id).catch(() => [] as MediaRow[]),
        fetchMediaJobs(m.id).catch(() => [] as BackgroundJobRow[]),
        fetchExportHistory(caseId, m.id).catch(() => [] as ExportManifestRow[]),
        fetchRelatedReportIds(m.id).catch(() => [] as string[]),
      ])
      setData({ custody, chain, derivatives, jobs, manifests, reportIds })
      setLoadError(false)
    } catch { setLoadError(true) }
  }, [m.id, caseId, registered])
  useEffect(() => { queueMicrotask(() => { void load() }) }, [load, vC, vJ, vM])

  const [transferOpen, setTransferOpen] = useState(false)
  const changed = () => { onChanged(); void load() }

  // ── Editable descriptive fields ────────────────────────────────────────
  const [form, setForm] = useState({
    title: m.title,
    category: m.category ?? '',
    classification: m.classification ?? 'unclassified',
    collectedBy: m.collected_by ?? '',
    collectedAt: toLocalInput(m.collected_at),
    location: m.location_collected ?? '',
    source: m.source ?? '',
  })
  const baseline = {
    title: m.title,
    category: m.category ?? '',
    classification: m.classification ?? 'unclassified',
    collectedBy: m.collected_by ?? '',
    collectedAt: toLocalInput(m.collected_at),
    location: m.location_collected ?? '',
    source: m.source ?? '',
  }
  const dirty = (Object.keys(form) as (keyof typeof form)[]).some((k) => form[k].trim() !== baseline[k].trim())
  const [saving, setSaving] = useState(false)
  const save = async () => {
    if (!form.title.trim()) { toast('A title is required.', 'warn'); return }
    setSaving(true)
    const res = await update('media', m.id, {
      title: form.title.trim(),
      category: form.category || null,
      classification: form.classification || null,
      collected_by: form.collectedBy || null,
      collected_at: fromLocalInput(form.collectedAt),
      location_collected: form.location.trim() || null,
      source: form.source.trim() || null,
    })
    setSaving(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Details saved.', 'success')
    onChanged()
  }

  const download = async () => {
    const url = storage ? await evidenceDownloadUrl(m) : safe
    if (!url) { toast('Could not prepare the download.', 'danger'); return }
    logEvidenceAccess(m, 'downloaded')
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const sha = sha256HexOf(m)
  const evNumber = evidenceNumberOf(m)
  const failure = data ? integrityFailureDetail(data.custody) : null
  const isVid = m.type === 'video'
  const isAud = m.type === 'fivemanage' || (m.mime ?? '').startsWith('audio/')
  const isPdf = m.mime === 'application/pdf'
  const reports = data ? data.reportIds.map((id) => ({ id, label: reportLabel(id) ?? 'Report' })) : []
  const menu = evidenceMenuItems({
    m, sealingEnabled, isCommand,
    onDetails: () => undefined,
    onTransfer: () => setTransferOpen(true),
    onChanged: changed,
  }).filter((it) => it.label !== 'Open details')

  return (
    <Modal open slide onClose={onClose} dirty={() => dirty}>
      <div className="p-5">
        <ModalHeader title={evNumber ?? m.title} onClose={onClose} />

        {/* Identity strip */}
        <div className="-mt-2 mb-4">
          <p className="text-sm font-semibold text-white">{m.title}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {storage ? <IntegrityBadge status={m.integrity_status} lastCheck={m.last_integrity_check} /> : <ExternalHostLine />}
            {m.sealed_at && <Badge tone="accent" title={`Sealed ${fmtDateTime(m.sealed_at)}`}>Sealed</Badge>}
            {m.restricted && <Badge tone="danger">Restricted</Badge>}
            {m.classification && m.classification !== 'unclassified' && <Badge tone="warn">{classificationLabel(m.classification)}</Badge>}
            {m.parent_media_id && <Badge tone="neutral">{derivativeTypeLabel(m.derivative_type)}</Badge>}
            {m.archived_at && <Badge tone="neutral">Archived</Badge>}
          </div>
        </div>

        {/* Integrity failure — the loudest thing on the sheet */}
        {m.integrity_status === 'failed' && (
          <div role="alert" className="mb-4 rounded-lg border border-rose-400/30 bg-rose-500/[0.07] p-3">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-rose-100"><AlertIcon size={16} />Integrity failure</p>
            <p className="mt-1 text-xs text-rose-200/80">
              The stored bytes no longer match the hash recorded at ingest. The original digest is never changed; the case lead, the custodian and every Owner were notified.
            </p>
            {failure && (
              <dl className="mt-2 space-y-1 font-mono text-[11px]">
                <div className="flex gap-2"><dt className="w-16 flex-shrink-0 text-rose-200/70">Expected</dt><dd className="break-all text-rose-100">{failure.expected ?? '—'}</dd></div>
                <div className="flex gap-2"><dt className="w-16 flex-shrink-0 text-rose-200/70">Actual</dt><dd className="break-all text-rose-100">{failure.actual ?? '—'}</dd></div>
              </dl>
            )}
          </div>
        )}

        {/* Preview */}
        {safe ? (
          m.type === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed / external media URL
            <img src={safe} alt={m.title} className="max-h-[40vh] w-full rounded-lg bg-black object-contain" />
          ) : isVid ? (
            <video src={safe} controls playsInline className="max-h-[40vh] w-full rounded-lg bg-black" />
          ) : isAud ? (
            <div className="rounded-lg bg-ink-800 p-4"><audio src={safe} controls className="w-full" /></div>
          ) : isPdf ? (
            <iframe src={safe} title={m.title} className="h-[40vh] w-full rounded-lg bg-black" />
          ) : (
            <TypeTile m={m} />
          )
        ) : storage ? (
          <div className="flex h-24 items-center justify-center rounded-lg bg-ink-800 text-xs text-slate-400" aria-live="polite">Preparing a signed link…</div>
        ) : (
          <TypeTile m={m} />
        )}

        {/* Actions */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {safe && (
            <a
              href={safe}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => logEvidenceAccess(m, 'downloaded')}
              className="inline-flex min-h-9 items-center rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-badge-200 hover:bg-white/5"
            >
              Open original ↗
            </a>
          )}
          {(storage || safe) && <Button size="sm" onAction={download}>Download</Button>}
          {registered && <Button size="sm" onClick={() => setTransferOpen(true)} disabled={!!m.sealed_at}>Transfer custody…</Button>}
          <span className="flex-1" />
          {menu.length > 0 && <ActionMenu items={menu} label="Evidence actions" />}
          <Button size="sm" variant="ghost" onClick={onOpenMediaOptions}>More media options…</Button>
        </div>

        {/* Facts */}
        <section aria-label="Evidence details" className="mt-5">
          <h4 className="text-[13px] font-semibold text-white">Details</h4>
          <dl className={`mt-2 grid gap-x-6 gap-y-2 text-sm ${narrow ? 'grid-cols-1' : 'grid-cols-2'}`}>
            <Row k="Evidence number" v={evNumber ?? '—'} mono />
            <Row k="Case" v={caseNumber} mono />
            <Row k="Evidence type" v={EVIDENCE_TYPE_LABEL[m.type] ?? m.type} />
            <Row k="Category" v={caseMediaCategoryLabel(m.category)} />
            <Row k="Classification" v={classificationLabel(m.classification)} />
            <Row k="Original filename" v={m.original_filename ?? '—'} />
            <Row k="MIME" v={m.mime ?? '—'} mono />
            <Row k="Size" v={formatBytes(m.byte_size)} />
            <Row k="Uploaded" v={`${fmtDateTime(m.created_at)}${officerName(m.uploaded_by) ? ` · ${officerName(m.uploaded_by)}` : ''}`} />
            <Row k="Collected" v={m.collected_at || m.collected_by ? `${m.collected_at ? fmtDateTime(m.collected_at) : '—'}${officerName(m.collected_by) ? ` · ${officerName(m.collected_by)}` : ''}` : '—'} />
            <Row k="Location collected" v={m.location_collected ?? '—'} />
            <Row k="Source" v={m.source ?? '—'} />
            <Row k="Current custodian" v={officerName(m.current_custodian) ?? '—'} />
            <Row k="Storage path" v={m.storage_path ? truncateMiddle(m.storage_path, 40) : isExternalHosted(m) ? 'External host' : '—'} mono title={m.storage_path ?? undefined} />
            <Row k="Integrity status" v={storage ? <IntegrityBadge status={m.integrity_status} lastCheck={m.last_integrity_check} /> : 'Not tracked (external host)'} />
            <Row k="Last integrity check" v={m.last_integrity_check ? fmtDateTime(m.last_integrity_check) : 'Never'} />
            <Row k="Lineage" v={m.parent_media_id ? `Derivative — ${derivativeTypeLabel(m.derivative_type)}${m.derivative_service ? ` · ${m.derivative_service}${m.derivative_service_version ? ` ${m.derivative_service_version}` : ''}` : ''}` : 'Original'} />
            {m.parent_media_id && (
              <Row
                k="Parent"
                v={(
                  <button type="button" onClick={() => onOpenRow(m.parent_media_id!)} className="min-h-9 text-left font-mono text-badge-200 hover:underline">
                    {parent ? (evidenceNumberOf(parent) ?? parent.title) : 'Open parent'}
                  </button>
                )}
              />
            )}
            {m.parent_sha256 && <Row k="Parent SHA-256" v={shortHash(m.parent_sha256)} mono title={m.parent_sha256} />}
            {m.sealed_at && <Row k="Sealed" v={`${fmtDateTime(m.sealed_at)}${officerName(m.sealed_by) ? ` · ${officerName(m.sealed_by)}` : ''}`} />}
          </dl>
          <div className="mt-3">
            <p className="text-xs font-medium text-slate-500">SHA-256</p>
            {sha ? (
              <div className="mt-1 flex items-start gap-2">
                <code translate="no" className="min-w-0 flex-1 break-all rounded bg-white/5 px-2 py-1 font-mono text-[11px] text-slate-200">{sha}</code>
                <Button size="sm" variant="secondary" onClick={() => copyText(sha, 'SHA-256')} aria-label="Copy SHA-256">Copy</Button>
              </div>
            ) : (
              <p className="mt-1 text-xs text-slate-400">{storage ? 'Not registered yet.' : 'External-hosted media cannot be hashed.'}</p>
            )}
          </div>
        </section>

        {/* Editable descriptive fields */}
        {canEdit && (
          <section aria-label="Edit descriptive fields" className="mt-5 space-y-3">
            <h4 className="text-[13px] font-semibold text-white">Descriptive fields</h4>
            <div className={`grid gap-3 ${narrow ? 'grid-cols-1' : 'grid-cols-2'}`}>
              <Field label="Title" required className={narrow ? '' : 'col-span-2'}>
                {(id) => <Input id={id} name="title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />}
              </Field>
              <Field label="Category">
                {(id) => (
                  <Select id={id} name="category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                    <option value="">Uncategorized</option>
                    {CASE_MEDIA_CATEGORIES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Classification">
                {(id) => (
                  <Select id={id} name="classification" value={form.classification} onChange={(e) => setForm({ ...form, classification: e.target.value })}>
                    {CLASSIFICATIONS.map((x) => <option key={x} value={x}>{classificationLabel(x)}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Collected by">
                {(id) => (
                  <Select id={id} name="collected_by" value={form.collectedBy} onChange={(e) => setForm({ ...form, collectedBy: e.target.value })}>
                    <option value="">— unknown —</option>
                    {activeProfiles().map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Collected at">
                {(id) => <Input id={id} name="collected_at" type="datetime-local" value={form.collectedAt} onChange={(e) => setForm({ ...form, collectedAt: e.target.value })} />}
              </Field>
              <Field label="Location collected">
                {(id) => <Input id={id} name="location_collected" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. 1420 Vespucci Blvd, unit 3…" />}
              </Field>
              <Field label="Source">
                {(id) => <Textarea id={id} name="source" rows={2} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="e.g. Seized during search warrant SW-0113…" />}
              </Field>
            </div>
            {dirty && <Button size="sm" variant="primary" loading={saving} onClick={() => void save()}>Save details</Button>}
          </section>
        )}

        {/* Custody */}
        {registered && (
          <section aria-label="Custody history" className="mt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-[13px] font-semibold text-white">Custody history</h4>
              {data?.chain && (
                <span className={`inline-flex items-center gap-1 text-xs font-semibold ${data.chain.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {data.chain.ok ? <CheckIcon size={13} /> : <AlertIcon size={13} />}
                  {data.chain.ok ? `Chain verified · ${data.chain.events} ${data.chain.events === 1 ? 'event' : 'events'}` : `Chain broken${data.chain.first_bad_id ? ` at event #${data.chain.first_bad_id}` : ''}`}
                </span>
              )}
            </div>
            {!data ? (
              loadError ? <p className="mt-2 text-xs text-rose-300">Could not load the custody trail. <button type="button" onClick={() => void load()} className="underline">Retry</button></p> : <div className="mt-2"><ListSkeleton count={3} /></div>
            ) : data.custody.length === 0 ? (
              <p className="mt-2 text-xs text-slate-400">No custody events recorded yet.</p>
            ) : (
              <ol className="mt-2 space-y-1.5">
                {data.custody.map((e) => <CustodyRow key={e.id} e={e} />)}
              </ol>
            )}
          </section>
        )}

        {/* Derivatives */}
        <section aria-label="Derivatives" className="mt-5">
          <h4 className="text-[13px] font-semibold text-white">Derivatives</h4>
          {!data ? <div className="mt-2"><ListSkeleton count={2} /></div> : data.derivatives.length === 0 ? (
            <p className="mt-2 text-xs text-slate-400">No derivatives (previews, OCR text or redactions) yet.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {data.derivatives.map((d) => (
                <li key={d.id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-ink-950/50 px-3 py-2">
                  <span aria-hidden className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-white/5 text-slate-300"><FileTypeIcon type={d.type} size={16} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-white">{derivativeTypeLabel(d.derivative_type)}{d.title ? ` — ${d.title}` : ''}</span>
                    <span className="block text-xs text-slate-400">{[d.derivative_service ? `${d.derivative_service}${d.derivative_service_version ? ` ${d.derivative_service_version}` : ''}` : null, fmtDateTime(d.created_at), formatBytes(d.byte_size)].filter(Boolean).join(' · ')}</span>
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => onOpenRow(d.id)} aria-label={`Open ${derivativeTypeLabel(d.derivative_type)}`}>Open</Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Processing */}
        <section aria-label="Processing history" className="mt-5">
          <h4 className="text-[13px] font-semibold text-white">Processing history</h4>
          {!data ? <div className="mt-2"><ListSkeleton count={2} /></div> : data.jobs.length === 0 ? (
            <p className="mt-2 text-xs text-slate-400">No processing jobs visible for this item.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {data.jobs.map((j) => {
                const p = jobProgressOf(j)
                return (
                  <li key={j.id} className="rounded-lg border border-white/10 bg-ink-950/50 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm text-white">{jobKindLabel(j.kind)}</span>
                      <Badge tone={jobStatusTone(j.status)}>{j.status}</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {fmtDateTime(j.finished_at ?? j.started_at ?? j.created_at)}
                      {p.pct !== null ? ` · ${p.pct}%` : ''}{p.step ? ` · ${p.step}` : ''}{p.message ? ` · ${p.message}` : ''}
                      {j.attempts > 1 ? ` · attempt ${j.attempts}/${j.max_attempts}` : ''}
                    </p>
                    {j.error && <p className="mt-0.5 break-words text-xs text-rose-300">{j.error}</p>}
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* Exports */}
        <section aria-label="Export history" className="mt-5">
          <h4 className="text-[13px] font-semibold text-white">Export history</h4>
          {!data ? <div className="mt-2"><ListSkeleton count={1} /></div> : data.manifests.length === 0 ? (
            <p className="mt-2 text-xs text-slate-400">Not included in any case packet or bundle yet.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {data.manifests.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-ink-950/50 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-white">{manifestKindLabel(x.kind)}</span>
                    <span className="block text-xs text-slate-400">{fmtDateTime(x.created_at)}{officerName(x.created_by) ? ` · ${officerName(x.created_by)}` : ''} · manifest {shortHash(x.manifest_sha256)}</span>
                  </span>
                  <Link href={caseLink(caseId, 'documents', x.kind === 'case_packet' ? { packet: x.bundle_id } : {})} className="inline-flex min-h-9 items-center text-xs font-semibold text-badge-200 hover:underline">
                    Verify
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Related */}
        <section aria-label="Related records" className="mt-5">
          <h4 className="text-[13px] font-semibold text-white">Related records</h4>
          {related.length === 0 && reports.length === 0 && !m.report_id && !m.observation_id ? (
            <p className="mt-2 text-xs text-slate-400">No linked records. Link a report or vehicle from “More media options”.</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {related.map((r) => <EntityLink key={r.key} kind={r.kind} id={r.id} label={r.label} />)}
              {m.report_id && (
                <Link href={caseLink(caseId, 'reports', { report: m.report_id })} className="inline-flex min-h-9 items-center rounded-md border border-white/10 bg-white/5 px-2 text-xs font-medium text-blue-200 hover:bg-white/10">
                  {reportLabel(m.report_id) ?? 'Report'}
                </Link>
              )}
              {reports.filter((r) => r.id !== m.report_id).map((r) => (
                <Link key={r.id} href={caseLink(caseId, 'reports', { report: r.id })} className="inline-flex min-h-9 items-center rounded-md border border-white/10 bg-white/5 px-2 text-xs font-medium text-blue-200 hover:bg-white/10">
                  {r.label}
                </Link>
              ))}
              {m.observation_id && (
                <Link href={caseLink(caseId, 'surveillance')} className="inline-flex min-h-9 items-center rounded-md border border-white/10 bg-white/5 px-2 text-xs font-medium text-blue-200 hover:bg-white/10">
                  Surveillance observation
                </Link>
              )}
            </div>
          )}
        </section>
      </div>

      {transferOpen && (
        <TransferCustodyDialog m={m} onClose={() => setTransferOpen(false)} onDone={() => { setTransferOpen(false); changed() }} />
      )}
    </Modal>
  )
}

function manifestKindLabel(kind: string): string {
  switch (kind) {
    case 'case_packet': return 'Case packet'
    case 'evidence_bundle': return 'Evidence bundle'
    case 'disclosure': return 'Disclosure export'
    default: return kind
  }
}

function truncateMiddle(s: string, max: number): string {
  if (s.length <= max) return s
  const half = Math.floor((max - 1) / 2)
  return `${s.slice(0, half)}…${s.slice(s.length - half)}`
}

function Row({ k, v, mono, title }: { k: string; v: React.ReactNode; mono?: boolean; title?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-slate-500">{k}</dt>
      <dd className={`min-w-0 break-words text-slate-200 ${mono ? 'font-mono text-xs' : ''}`} title={title}>{v}</dd>
    </div>
  )
}

function TypeTile({ m }: { m: MediaRow }) {
  return (
    <div className="flex h-24 flex-col items-center justify-center gap-1.5 rounded-lg bg-ink-800 text-slate-400">
      <FileTypeIcon type={m.type === 'fivemanage' ? 'audio' : m.type} size={36} />
      <span className="text-xs font-medium">{EVIDENCE_TYPE_LABEL[m.type] ?? m.type}</span>
    </div>
  )
}

function CustodyRow({ e }: { e: CustodyEventRow }) {
  const failure = e.event_type === 'INTEGRITY_FAILURE'
  const custody = e.previous_custodian || e.new_custodian
    ? `${officerName(e.previous_custodian) ?? '—'} → ${officerName(e.new_custodian) ?? '—'}`
    : null
  return (
    <li className={`rounded-lg border px-3 py-2 ${failure ? 'border-rose-400/30 bg-rose-500/[0.06]' : 'border-white/10 bg-ink-950/50'}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className={`text-sm font-semibold ${failure ? 'text-rose-100' : 'text-white'}`}>{custodyEventLabel(e.event_type)}</span>
        <span className="text-xs text-slate-400">{fmtDateTime(e.occurred_at)}</span>
        <span className="ml-auto font-mono text-[10px] text-slate-500" title="Event hash">{shortHash(e.event_hash, 8)}</span>
      </div>
      <p className="mt-0.5 text-xs text-slate-400">
        {officerName(e.actor_id) ?? 'Evidence service'}
        {custody ? ` · ${custody}` : ''}
        {e.reason ? ` · ${e.reason}` : ''}
      </p>
    </li>
  )
}
